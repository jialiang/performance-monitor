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

## Install

1. Run `npm install` in root and in the `/functions` path.
2. Run `npx firebase login`.
3. Create a file `env.jsonc` in `/functions` for your environment variables. Refer to `example.env.jsonc` for valid keys and values.
4. (Optional) Set up BigQuery for storage. Each check writes one row, with its per-resource requests nested in a `requests` array.

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

   Then grant the function's service account write access:

   ```
   bq add-iam-policy-binding \
     --member="serviceAccount:<FUNCTION_SERVICE_ACCOUNT>" \
     --role="roles/bigquery.dataEditor" \
     <project>:monitoring
   ```

   The deployed functions authenticate via the attached service account (ADC) — no credentials in the config. Rows older than 7 days are pruned automatically by partition expiration. Set the `BIGQUERY_*` keys in `env.jsonc` (see `example.env.jsonc`) to enable logging.

## Develop

1. Run `npm run build:watch` in the `/functions` path.
2. Run `npx firebase emulators:start` in root.

Make sure Java is installed. It is required by the pubsub emulator. You can check by running `java --version`.

## Deploy

1. Run `npx firebase projects:list` to list your projects. You can go to https://console.firebase.google.com to create a project.
2. Run `npx firebase use --add <project-id>` to set the active project.
3. Run `npx firebase deploy` in root.

## Motivation

The motivation for creating this service is to prevent CDN cache eviction of critical resources. CDNs will remove low demand resources from their edge servers periodically. This removal might occur even if the resource hasn't gone stale yet. This can cause low traffic websites to lose the benefits of a CDN even if they are set up with one. Creating artificial demand is one way to solve this problem.
