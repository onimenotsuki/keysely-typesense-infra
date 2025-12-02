# Keysely Typesense Infrastructure

This project deploys a self-hosted Typesense search engine on AWS using AWS CDK. It provides a scalable and cost-effective search solution for Keysely projects.

## Architecture

The infrastructure varies by environment to optimize costs:

- **Dev/Stage**:
  - **Compute**: Single EC2 instance (t3.micro) managed by an Auto Scaling Group.
  - **Network**: Placed in a public subnet (to avoid NAT Gateway costs).
  - **Access**: Direct access via the instance's Public IP.
- **Prod**:
  - **Compute**: ECS Fargate service with an Application Load Balancer.
  - **Network**: High availability configuration.
  - **Access**: Access via the Load Balancer DNS name.

**Security**: The Typesense API Key is securely generated and stored in **AWS Secrets Manager**.

## How to Connect

To use this Typesense instance in your applications (Next.js, Node.js, Python, etc.), you need the **Host** and the **API Key**.

### 1. Retrieve Credentials

You can find the connection details in the AWS Console after deployment.

#### Host (Server URL)

- **Prod**: Look for the CloudFormation Output named `typesense-load-balancer-dns`. This is your host URL.
- **Dev/Stage**:
  1.  Go to the **EC2 Console** in AWS.
  2.  Find the instance launched by the `typesense-asg` Auto Scaling Group.
  3.  Copy its **Public IPv4 address**. This is your host.

#### API Key

The API Key is not exposed in plain text. It is stored in Secrets Manager.

1.  Go to the **Secrets Manager Console** in AWS.
2.  Find the secret named `typesense-api-key` (or check the CloudFormation Output `typesense-api-key-secret-name`).
3.  Retrieve the Secret Value. The key is stored under the JSON key `apiKey`.

### 2. Client Configuration

Install the Typesense client in your project:

```bash
npm install typesense
```

Configure the client in your code:

```typescript
import Typesense from 'typesense';

// Replace these with your actual values
const TYPESENSE_HOST = process.env.TYPESENSE_HOST; // e.g., '12.34.56.78' or 'load-balancer-dns.amazonaws.com'
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY; // Retrieved from Secrets Manager

const client = new Typesense.Client({
  nodes: [
    {
      host: TYPESENSE_HOST,
      port: 8108, // Default port configured in this infra
      protocol: 'http', // Use 'http' (unless you've added a custom domain with SSL)
    },
  ],
  apiKey: TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 2,
});

export default client;
```

## Integration Guide (e.g., Supabase)

Since this Typesense instance is decoupled from your database (like Supabase), you need to synchronize data between them.

### Strategy

1.  **Initial Indexing**: Run a script to fetch all records from your database and import them into Typesense.
2.  **Real-time Sync**: Use Webhooks or Database Triggers to update Typesense whenever data changes in your database.

### Example: Syncing from Supabase

You can use Supabase Database Webhooks or Edge Functions to trigger updates.

**Pseudocode for an Edge Function (on Insert/Update):**

```typescript
// On Supabase record insertion/update
const { data, error } = await supabase.from('posts').select('*').eq('id', newRecordId);

if (data) {
  const document = {
    id: data.id,
    title: data.title,
    content: data.content,
    // ... map other fields
  };

  // Upsert into Typesense
  await typesenseClient.collections('posts').documents().upsert(document);
}
```
