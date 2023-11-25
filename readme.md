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

The information collected is sent to a PostgreSQL database for storage (optional, to be set up separately).

Each serverless function is allocated 0.5 vCPU (1 vCPU is equivalent to 2.4Ghz) and the default amount of memory (256MB).

## Install

1. Run `npm install` in root and in the `/functions` path.
2. Run `npx firebase login`.
3. Create a file `env.jsonc` in `/functions` for your environment variables. Refer to `example.env.jsonc` for valid keys and values. 
4. (Optional) Create a PostgreSQL server with the following schemas:

   ```
   CREATE TABLE "Connections" (
       id serial PRIMARY KEY,
       region text NOT NULL,
       "startTime" timestamp without time zone NOT NULL,
       "dnsLookupStart" integer,
       "dnsLookupEnd" integer,
       "tcpDone" integer,
       "tlsDone" integer,
       errors json[]
   );

   CREATE TABLE "Requests" (
       id serial PRIMARY KEY,
       "connectionId" bigint NOT NULL REFERENCES "Connections"(id) ON DELETE CASCADE,
       filename text NOT NULL,
       "requestSent" integer,
       "responseStart" integer,
       "responseEnd" integer,
       "responseHeaders" json,
       errors json[]
   );
   ```

## Develop

1. Run `npm run build:watch` in the `/functions` path.
2. Run `npx firebase emulators:start` in root.

## Deploy

- Run `npx firebase deploy` in root.

## Motivation

The motivation for creating this service is to prevent CDN cache eviction of critical resources. CDNs will remove low demand resources from their edge servers periodically. This removal might occur even if the resource hasn't gone stale yet. This can cause low traffic websites to lose the benefits of a CDN even if they are set up with one. Creating artificial demand is one way to solve this problem.
