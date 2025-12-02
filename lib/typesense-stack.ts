import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as crypto from 'crypto';

interface TypesenseStackProps extends cdk.StackProps {
  environment: 'dev' | 'stage' | 'prod';
}

function generateApiKey(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

export class TypesenseStack extends cdk.Stack {
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: TypesenseStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // 1. VPC
    const vpc = new ec2.Vpc(this, 'typesense-vpc', {
      maxAzs: 2,
      natGateways: environment === 'prod' ? 1 : 0, // NAT Gateway only for Prod
    });

    // 2. Secrets Manager for API Key
    const apiKeySecret = new secretsmanager.Secret(this, 'typesense-api-key', {
      description: 'API Key for Typesense',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: generateApiKey() }), // Default value, should be rotated
        generateStringKey: 'apiKey',
      },
    });

    // 3. ECS Cluster
    const cluster = new ecs.Cluster(this, 'typesense-cluster', {
      vpc,
      clusterName: `keysely-typesense-cluster-${environment}`,
    });

    // 4. CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'typesense-log-group', {
      logGroupName: `/ecs/typesense-${environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/stage, maybe RETAIN for prod
    });

    // 5. Auto Scaling Group (EC2 Launch Type for Free Tier)
    // t3.micro is free tier eligible (750 hours/month)
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'typesense-asg', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 1, // Keep to 1 to stay within free tier
      vpcSubnets: {
        // In prod, use private subnets with NAT Gateway.
        // In dev (free tier), use public subnets because we don't have a NAT Gateway.
        subnetType:
          environment === 'prod' ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC,
      },
      newInstancesProtectedFromScaleIn: false,
    });

    // 6. Capacity Provider
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'typesense-capacity-provider', {
      autoScalingGroup,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    // 7. Task Definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'typesense-task-def', {
      networkMode: ecs.NetworkMode.BRIDGE,
    });

    // Mount a volume for data (Ephemeral on EC2 instance store/root volume)
    taskDefinition.addVolume({
      name: 'typesense-data',
      host: {
        sourcePath: '/var/lib/typesense/data',
      },
    });

    const container = taskDefinition.addContainer('typesense-container', {
      image: ecs.ContainerImage.fromRegistry('typesense/typesense:26.0'),
      memoryLimitMiB: 512, // Leave some RAM for OS (Total 1024MB on t3.micro)
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'typesense',
        logGroup,
      }),
      secrets: {
        TYPESENSE_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret, 'apiKey'),
      },
      environment: {
        TYPESENSE_DATA_DIR: '/data',
        TYPESENSE_ENABLE_CORS: 'true',
      },
      command: ['--data-dir', '/data', '--enable-cors'],
    });

    container.addPortMappings({
      containerPort: 8108,
      hostPort: 8108,
      protocol: ecs.Protocol.TCP,
    });

    container.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'typesense-data',
      readOnly: false,
    });

    // 8. Service
    const service = new ecs.Ec2Service(this, 'typesense-service', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      minHealthyPercent: 0, // Allow 0 during deployment to avoid needing 2 instances
      maxHealthyPercent: 100,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
    });

    // 9. Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'typesense-alb', {
      vpc,
      internetFacing: true, // Public access as requested
      loadBalancerName: `keysely-typesense-alb-${environment}`,
    });

    const listener = this.loadBalancer.addListener('typesense-listener', {
      port: 80,
    });

    listener.addTargets('typesense-target', {
      port: 80,
      targets: [
        service.loadBalancerTarget({
          containerName: 'typesense-container',
          containerPort: 8108,
        }),
      ],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(60),
      },
    });

    // Allow ALB to connect to ASG on port 8108
    autoScalingGroup.connections.allowFrom(
      this.loadBalancer,
      ec2.Port.tcp(8108),
      'Allow ALB to connect to Typesense instances',
    );

    this.apiUrl = `http://${this.loadBalancer.loadBalancerDnsName}`;

    // Outputs
    new cdk.CfnOutput(this, 'typesense-api-url', {
      value: this.apiUrl,
      description: 'Typesense API URL',
    });

    new cdk.CfnOutput(this, 'typesense-api-key-secret-arn', {
      value: apiKeySecret.secretArn,
      description: 'ARN of the Typesense API Key Secret',
    });
  }
}
