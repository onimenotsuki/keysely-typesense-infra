#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { TypesenseStack } from '../lib/typesense-stack';

const app = new cdk.App();

new TypesenseStack(
  app,
  `keysely-typesense-${process.env.CDK_DEFAULT_ENVIRONMENT}-stack-${process.env.CDK_DEFAULT_REGION}`,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    environment: process.env.CDK_DEFAULT_ENVIRONMENT as 'dev' | 'stage' | 'prod',
  },
);
