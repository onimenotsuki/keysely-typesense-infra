import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

interface TypesenseStackProps extends cdk.StackProps {
  environment: 'dev' | 'stage' | 'prod';
}

export class TypesenseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TypesenseStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // VPC
    const vpc = new ec2.Vpc(this, 'TypesenseVpc', {
      maxAzs: 2,
      natGateways: environment === 'prod' ? 1 : 0, // No NAT Gateway for Dev/Stage to save costs
    });

    // Secrets Manager for API Key
    const apiKeySecret = new secretsmanager.Secret(this, 'TypesenseApiKey', {
      description: 'API Key for Typesense',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: 'xyz' }), // Default value, should be rotated/changed
        generateStringKey: 'apiKey',
      },
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'TypesenseCluster', {
      vpc,
    });

    if (environment === 'dev' || environment === 'stage') {
      // Free Tier: ECS on EC2 (t2.micro)

      // Auto Scaling Group
      const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'TypesenseASG', {
        vpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
        minCapacity: 1,
        maxCapacity: 1,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC, // Public subnet to avoid NAT Gateway costs
        },
        newInstancesProtectedFromScaleIn: false,
      });

      // Capacity Provider
      const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
        autoScalingGroup,
      });
      cluster.addAsgCapacityProvider(capacityProvider);

      // Task Definition
      const taskDefinition = new ecs.Ec2TaskDefinition(this, 'TypesenseTaskDef', {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });

      const container = taskDefinition.addContainer('TypesenseContainer', {
        image: ecs.ContainerImage.fromRegistry('typesense/typesense:26.0'),
        memoryLimitMiB: 900, // t2.micro has 1GB, reserving some for OS/Agent
        cpu: 512, // 0.5 vCPU
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'Typesense' }),
        secrets: {
          TYPESENSE_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret, 'apiKey'),
        },
        command: ['--data-dir', '/data', '--enable-cors'],
        environment: {
          TYPESENSE_DATA_DIR: '/data',
        },
      });

      container.addPortMappings({
        containerPort: 8108,
        hostPort: 8108,
      });

      // Service
      const service = new ecs.Ec2Service(this, 'TypesenseService', {
        cluster,
        taskDefinition,
        desiredCount: 1,
        capacityProviderStrategies: [
          {
            capacityProvider: capacityProvider.capacityProviderName,
            weight: 1,
          },
        ],
        assignPublicIp: true, // Needed for public subnet
      });

      // Allow access to port 8108
      service.connections.allowFromAnyIpv4(ec2.Port.tcp(8108), 'Allow Typesense API access');
    } else {
      // Production: ECS Fargate
      const loadBalancedFargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(
        this,
        'TypesenseService',
        {
          cluster,
          cpu: 512,
          memoryLimitMiB: 1024,
          desiredCount: 2,
          taskImageOptions: {
            image: ecs.ContainerImage.fromRegistry('typesense/typesense:26.0'),
            containerPort: 8108,
            secrets: {
              TYPESENSE_API_KEY: ecs.Secret.fromSecretsManager(apiKeySecret, 'apiKey'),
            },
            command: ['--data-dir', '/data', '--enable-cors'],
          },
          publicLoadBalancer: true,
        },
      );

      // Health check
      loadBalancedFargateService.targetGroup.configureHealthCheck({
        path: '/health',
      });
    }
  }
}
