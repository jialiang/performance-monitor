import http2 from "http2";

export type ERROR = NodeJS.ErrnoException | Error;

export type ResponseHeaders = http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader;

export type Resource = {
  path: string;
  label: string;
  logToDatabase?: boolean;
};

export type ErrorEntry = {
  [key: string]: string | number | boolean;
} & {
  stack?: never;
};

export type ConnectionEntry = {
  dnsLookupStart?: number;
  dnsLookupEnd?: number;
  tcpDone?: number;
  firstKeyDerived?: number;
  tlsDone?: number;
  tlsVersion?: string;
  serverAddress?: string;
  maxStall?: number;
  dnsMaxStall?: number;
  tcpMaxStall?: number;
  tlsMaxStall?: number;
  errors?: ErrorEntry[];
};

export type RequestEntry = {
  filename: string;
  requestSent?: number;
  responseStart?: number;
  responseEnd?: number;
  requestMaxStall?: number;
  downloadMaxStall?: number;
  responseHeaders?: ResponseHeaders;
  errors?: ErrorEntry[];
};
