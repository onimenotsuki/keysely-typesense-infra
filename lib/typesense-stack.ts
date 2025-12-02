import * as cdk from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface TypesenseStackProps extends cdk.StackProps {
  environment: 'dev' | 'stage' | 'prod';
}

export class TypesenseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TypesenseStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // VPC
    const vpc = new ec2.Vpc(this, 'typesense-vpc', {
      maxAzs: 2,
      natGateways: environment === 'prod' ? 1 : 0, // No NAT Gateway for Dev/Stage to save costs
    });

    // Secrets Manager for API Key
    const apiKeySecret = new secretsmanager.Secret(this, 'typesense-api-key', {
      description: 'API Key for Typesense',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: 'xyz' }), // Default value, should be rotated/changed
        generateStringKey: 'apiKey',
      },
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'typesense-cluster', {
      vpc,
    });

    if (environment === 'dev' || environment === 'stage') {
      // Free Tier: ECS on EC2 (t2.micro)

      // User Data to register with ECS Cluster
      const userData = ec2.UserData.forLinux();
      userData.addCommands(`echo ECS_CLUSTER=${cluster.clusterName} >> /etc/ecs/ecs.config`);

      // Launch Template
      const launchTemplate = new ec2.LaunchTemplate(this, 'typesense-launch-template', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
        userData,
        role: new iam.Role(this, 'typesense-instance-role', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              'service-role/AmazonEC2ContainerServiceforEC2Role',
            ),
          ],
        }),
      });

      // Auto Scaling Group
      const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'typesense-asg', {
        vpc,
        launchTemplate,
        minCapacity: 1,
        maxCapacity: 1,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC, // Public subnet to avoid NAT Gateway costs
        },
        newInstancesProtectedFromScaleIn: false,
      });

      // Capacity Provider
      const capacityProvider = new ecs.AsgCapacityProvider(this, 'asg-capacity-provider', {
        autoScalingGroup,
      });
      cluster.addAsgCapacityProvider(capacityProvider);

      // Task Definition
      const taskDefinition = new ecs.Ec2TaskDefinition(this, 'typesense-task-def', {
        networkMode: ecs.NetworkMode.AWS_VPC,
      });

      const container = taskDefinition.addContainer('typesense-container', {
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
      const service = new ecs.Ec2Service(this, 'typesense-service', {
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
        'typesense-service',
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

      new cdk.CfnOutput(this, 'typesense-load-balancer-dns', {
        value: loadBalancedFargateService.loadBalancer.loadBalancerDnsName,
        description: 'Typesense Load Balancer DNS Name',
      });
    }

    // Outputs for Secret
    new cdk.CfnOutput(this, 'typesense-api-key-secret-arn', {
      value: apiKeySecret.secretArn,
      description: 'ARN of the Typesense API Key Secret',
    });

    new cdk.CfnOutput(this, 'typesense-api-key-secret-name', {
      value: apiKeySecret.secretName,
      description: 'Name of the Typesense API Key Secret',
    });

    if (environment === 'dev' || environment === 'stage') {
      new cdk.CfnOutput(this, 'typesense-cluster-name', {
        value: cluster.clusterName,
        description: 'Typesense ECS Cluster Name',
      });

      new cdk.CfnOutput(this, 'typesense-service-name', {
        value: 'typesense-service', // Hardcoded as we named it explicitly
        description: 'Typesense ECS Service Name',
      });
    }
  }
}
