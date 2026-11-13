# Performance Monitor on Firebase

Deploys 1 or more serverless functions across different cities and 1 cloud scheduler.

Every minute, the scheduler will trigger the serverless functions. These serverless functions will each asynchronously fetch the designated resources using the HTTP2 protocol.

In the process, they will record the following network timings and metadata:

- DNS lookup time.
- TCP handshake time.
- TLS negotiation time.
- Time to HTTP2 HEADERS frame.
- Data transfer time.
- Response headers.

The information collected is sent to a BigQuery table for storage (optional, to be set up separately).

Each serverless function is allocated 0.5 vCPU (1 vCPU is equivalent to 2.4Ghz) and the default amount of memory (256MB).

## Requirements

- Node.js 22 or later. The functions themselves run on Node.js 24 in the cloud, as set in `firebase.json`.
- (optional) [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud` and `bq`). Potentially needed to bypass Region Limits, grant service account access or use BigQuery logging.
- (optional) Java 21 or later, if you run the local emulator.
- (optional) [AWS CLI](https://aws.amazon.com/cli/) and [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) (`aws` and `sam`). If deploying to AWS Lambda.

## Install

1. Run `npm install` in root and in the `/functions` path.
2. Run `npx firebase login`.
3. Create a file `env.jsonc` in `/functions` for your environment variables. Refer to `example.env.jsonc` for valid keys and values.
4. Set the list of resources to fetch in Firebase Remote Config, so it can be changed without a deploy.
   1. On your Firebase console's sidebar, go to DevOps & Engagement → Remote Config
   1. Choose server from the dropdown.
   1. Create a parameter named `env`, typed `JSON` and the following shape:

      ```
      {
        "RESOURCES": [
          { "path": "/", "label": "index" },
          { "path": "/path/to/resource/1", "label": "resource 1", "logToDatabase": true },
          { "path": "/path/to/resource/2", "label": "resource 2" }
        ]
      }
      ```

      Entries with `logToDatabase: true` are fetched with GET and logged. The rest are fetched with HEAD, which keeps them in the CDN cache without downloading them. A published change is picked up within 5 minutes. If the template can't be loaded or `RESOURCES` is missing, nothing is fetched and the error is logged.

      If needed, grant the function's service account read access to the template using:

      ```
      gcloud projects add-iam-policy-binding <project> \
        --member="serviceAccount:<FUNCTION_SERVICE_ACCOUNT>" \
        --role="roles/cloudconfig.viewer"
      ```

5. (Optional) Set up BigQuery for storage. Each check writes one row, each resource request is nested in a `requests` array.

   ```
   # Dataset
   bq --location=US mk -d <project>:monitoring

   # Table: partitioned by day, auto-expires rows after 7 days, clustered by region.
   # Schema lives in functions/bigquery/connections.schema.json.
   bq mk --table \
     --time_partitioning_field startTime \
     --time_partitioning_type DAY \
     --time_partitioning_expiration 604800 \
     --clustering_fields region \
     <project>:monitoring.connections \
     functions/bigquery/connections.schema.json
   ```

   If needed, grant the function's service account write access:

   ```
   bq query --use_legacy_sql=false \
     'GRANT `roles/bigquery.dataEditor` ON SCHEMA `<project>.monitoring`
      TO "serviceAccount:<FUNCTION_SERVICE_ACCOUNT>"'
   ```

   Rows older than 7 days are pruned automatically by partition expiration. Set the `BIGQUERY_*` keys in `env.jsonc` (see `example.env.jsonc`) to enable logging.

## Develop

1. Run `npm run build:watch` in the `/functions` path.
2. Run `npx firebase emulators:start` in root.

Make sure Java 21 or later is installed. It is required by the pubsub emulator. You can check by running `java --version`.

## Deploy

1. Run `npx firebase projects:list` to list your projects. You can go to https://console.firebase.google.com to create a project.
2. Run `npx firebase use --add <project-id>` to set the active project.
3. Run `npx firebase deploy` in root.

## Region Limits

Google Cloud sometimes limit the count of regions that you can deploy to, even with a billing account attached. There are 2 parts to the limit: Cloud Build and Cloud Run.

Cloud Build builds your code while Cloud Run is the platform that runs your code. If your quota for the latter is higher than the former, you can skip the build step by cloning the image Firebase already built to the extra regions:

1. Add the extra regions to `CALL_REGIONS` only (not `DEPLOY_REGIONS`) in `env.jsonc`.
2. Run `npx firebase deploy` in root so the trigger starts calling them.
3. Run `npm run clone` in the `/functions` path. For every region in `CALL_REGIONS` that isn't in `DEPLOY_REGIONS`, it deploys the image from the first deploy region as a plain Cloud Run service with the same settings, then lets the scheduler's service account call it.

The trigger logs errors for the extra regions between steps 2 and 3 until their clones exist.

Firebase doesn't manage these clones, so run `npm run clone` after each `firebase deploy` to move them to the new image. To move a region into `DEPLOY_REGIONS` later, delete its clone first with `gcloud run services delete check --region=<region>` or Firebase can't create the function there.

## AWS

Given the issues in Region Limits, deployment to AWS Lambda is added as a alternative. Logging to the same BigQuery table is supported, with regions labelled like `aws-ap-southeast-5`.

Note that Lambda functions are configured with the same amount of memory (256MB) as the Cloud Run functions. However AWS does not allow configuring vCPU amount directly and scale based on memory, so it gets 0.25 vCPU instead of 0.5.

### Setup

0. Make sure the steps in the Install section above have been performed.
1. Create a service account on AWS for the Lambda function in IAM → Roles:
   - Trusted entity type: AWS Service
   - Use case: Lambda
   - Permission policies: `AWSLambdaBasicExecutionRole`
   - Note the ARN value after creation.
2. In Google Cloud, go to IAM & Admin → Workload Identity Pools.
3. Create a new identity pool.
   - Set a identity pool name.
   - Select AWS as provider.
   - Set a provider name.
   - Enter your AWS account ID.
   - Ignore "Configure provider attributes".
4. Click the "Grant access" button.
   - Choose service account impersonation.
   - Select the service account that AWS Lambda should assume. It should have the same access as `FUNCTION_SERVICE_ACCOUNT`:
     - Remote Config VIEWER.
     - (optional) BigQuery dataset WRITER.
   - Set the principal name to "aws_role"
   - Set the principal value to the ARN of the AWS role who will be doing the assuming but modify the string:
     - Change `iam` to `sts`.
     - Change `role/` to `assumed-role/`.
5. In the dialog that follows, download the config file. Save it as `functions/aws/google-credentials.json`. It holds no secret.
6. Refer to `functions/aws/example.samconfig.yaml` to create `functions/aws/samconfig.yaml`.
7. Add in `AWS_REGIONS` in `env.jsonc`

### Deploy

1. Run `npm run clone:aws` in the `/functions` path to create or update. It runs `sam build` once, then `sam deploy` in each region.

To remove a region:

1. Remove it from `AWS_REGIONS` in `env.jsonc` so the next deploy doesn't recreate it.
2. Run `sam delete --stack-name check --region <region> --no-prompts` in the `/functions/aws` path.

If a region is used by nothing else at all:

1. Do `aws cloudformation delete-stack --stack-name aws-sam-cli-managed-default --region <region>` to delete the stack SAM created. Note that this stack is shared with all SAM deployments for that region without an explicitly defined S3 bucket. The stack is all resources SAM creates automatically to facilitate the deployment.

To remove AWS entirely, do the above for every region, then:

1. Delete the IAM role from Setup step 1.
2. In Google Cloud, delete the workload identity pool and the service account from Setup steps 3 and 4.

## Motivation

The motivation for creating this service is to prevent CDN cache eviction of critical resources. CDNs will remove low demand resources from their edge servers periodically. This removal might occur even if the resource hasn't gone stale yet. This can cause low traffic websites to lose the benefits of a CDN even if they are set up with one. Creating artificial demand is one way to solve this problem.
