import { SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

export const posthogLogProvider = projectToken && host
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "fanout-web" }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${host.replace(/\/$/, "")}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${projectToken}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ],
    })
  : null;

// This provider is intentionally not global: only log records created below leave the app.
const posthogIntegrationLogger = posthogLogProvider?.getLogger("posthog-integration");

type LogAttributes = Record<string, boolean | number | string>;

export function emitPosthogLog(
  body: string,
  severityNumber: SeverityNumber,
  attributes: LogAttributes
) {
  posthogIntegrationLogger?.emit({ body, severityNumber, attributes });
}

export async function flushPosthogLogs() {
  await posthogLogProvider?.forceFlush();
}

export function register() {
  // Next.js loads this module for the Node.js runtime; no global logger is registered.
}
