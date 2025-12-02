# AGENTS.md

## Project Overview

This project is an AWS CDK infrastructure repository for deploying a Typesense cluster on AWS. It supports multiple environments (Dev, Stage, Prod) and uses ECS (EC2 for Dev/Stage, Fargate for Prod).

## Setup Commands

- **Install dependencies**: `npm install`
- **Synthesize CloudFormation template**: `npx cdk synth`
- **Deploy to Dev**: `npx cdk deploy typesense-dev-stack` (or via CI/CD)
- **Run Tests**: `npm test` (Currently exits 0 as placeholder)
- **Lint**: `npm run lint`

## Code Style

- **Language**: TypeScript
- **Framework**: AWS CDK v2
- **Formatting**: Prettier (run `npm run format`)
- **Linting**: ESLint
- **Naming Convention**:
  - Resources: skewer-case (e.g., `typesense-vpc`, `typesense-service`)
  - Files: skewer-case (e.g., `typesense-stack.ts`)
  - Classes: PascalCase (e.g., `TypesenseStack`)
  - Outputs: skewer-case (e.g., `typesense-vpc-id`, `typesense-service-id`)

## Architecture Details

- **Compute**:
  - **Dev/Stage**: ECS on EC2 (`t3.micro`) using Auto Scaling Group and Launch Template.
    - Network Mode: `BRIDGE` (uses instance's public IP).
  - **Prod**: ECS on Fargate with Application Load Balancer.
- **Storage**: Ephemeral (instance store or Fargate ephemeral storage).
- **Secrets**: API Key stored in AWS Secrets Manager.
- **Networking**: VPC with Public Subnets (Dev/Stage) or Private with NAT (Prod - configurable).

## Key Files

- `bin/app.ts`: Entry point, defines stacks for environments.
  - Stack Name Pattern: `keysely-typesense-<env>-stack-<region>`
- `lib/typesense-stack.ts`: Main stack definition.
- `cdk.json`: CDK configuration.

## Maintenance

> [!IMPORTANT]
> **ALWAYS update this file (`AGENTS.md`) when making significant changes to the repository architecture, conventions, or setup instructions.**
