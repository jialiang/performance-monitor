import http2 from "http2";

export type ERROR = NodeJS.ErrnoException | Error;

export type ResponseHeaders = http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader;

export type ErrorEntry = {
  [key: string]: string | number | boolean;
} & {
  stack?: never;
};

export type ConnectionEntry = {
  dnsLookupStart?: number;
  dnsLookupEnd?: number;
  tcpDone?: number;
  tlsDone?: number;
  errors?: ErrorEntry[];
};

export type RequestEntry = {
  filename: string;
  requestSent?: number;
  responseStart?: number;
  responseEnd?: number;
  responseHeaders?: ResponseHeaders;
  errors?: ErrorEntry[];
};
