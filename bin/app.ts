#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { TypesenseStack } from '../lib/typesense-stack';

const app = new cdk.App();

// Dev Environment
new TypesenseStack(app, 'TypesenseStack-Dev', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  environment: 'dev',
});

// Stage Environment
new TypesenseStack(app, 'TypesenseStack-Stage', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  environment: 'stage',
});

// Prod Environment
new TypesenseStack(app, 'TypesenseStack-Prod', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  environment: 'prod',
});
