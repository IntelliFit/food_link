"""
OpenTelemetry optional compatibility layer.

When OpenTelemetry packages are unavailable in the current Python
environment, backend code can still import this module and continue
running with no-op tracing/logging behavior.
"""
from __future__ import annotations

import logging
from typing import Any

OTEL_AVAILABLE = True

try:
    from opentelemetry import trace  # type: ignore
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter  # type: ignore
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # type: ignore
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # type: ignore
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor  # type: ignore
    from opentelemetry.instrumentation.logging import LoggingInstrumentor  # type: ignore
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler  # type: ignore
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor  # type: ignore
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME  # type: ignore
    from opentelemetry.sdk.trace import TracerProvider  # type: ignore
    from opentelemetry.sdk.trace.export import BatchSpanProcessor  # type: ignore
    from opentelemetry.trace import Status, StatusCode, format_span_id, format_trace_id  # type: ignore
except Exception:
    OTEL_AVAILABLE = False

    class _NoOpSpanContext:
        is_valid = False
        trace_id = 0
        span_id = 0
        trace_flags = 0

    class _NoOpSpan:
        def get_span_context(self) -> _NoOpSpanContext:
            return _NoOpSpanContext()

        def set_attribute(self, _key: str, _value: Any) -> None:
            return None

        def set_attributes(self, _attributes: Any) -> None:
            return None

        def is_recording(self) -> bool:
            return False

        def add_event(self, _name: str, attributes: Any = None) -> None:
            return None

        def record_exception(self, _err: Exception) -> None:
            return None

        def set_status(self, _status: Any) -> None:
            return None

    class _NoOpTracer:
        def start_as_current_span(self, *_args: Any, **_kwargs: Any):
            class _NoOpContextManager:
                def __enter__(self) -> _NoOpSpan:
                    return _NoOpSpan()

                def __exit__(self, _exc_type: Any, _exc: Any, _tb: Any) -> bool:
                    return False

            return _NoOpContextManager()

    class _TraceCompat:
        @staticmethod
        def get_tracer(_name: str) -> _NoOpTracer:
            return _NoOpTracer()

        @staticmethod
        def get_current_span() -> _NoOpSpan:
            return _NoOpSpan()

        @staticmethod
        def set_tracer_provider(_provider: Any) -> None:
            return None

    trace = _TraceCompat()

    class StatusCode:
        ERROR = "ERROR"

    class Status:
        def __init__(self, status_code: Any, description: str = "") -> None:
            self.status_code = status_code
            self.description = description

    def format_span_id(_span_id: int) -> str:
        return "0000000000000000"

    def format_trace_id(_trace_id: int) -> str:
        return "00000000000000000000000000000000"

    class Resource:
        @staticmethod
        def create(_attrs: Any) -> "Resource":
            return Resource()

    SERVICE_NAME = "service.name"

    class TracerProvider:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def add_span_processor(self, _processor: Any) -> None:
            return None

    class BatchSpanProcessor:
        def __init__(self, _exporter: Any) -> None:
            pass

    class OTLPSpanExporter:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

    class FastAPIInstrumentor:
        @staticmethod
        def instrument_app(*args: Any, **kwargs: Any) -> None:
            return None

    class HTTPXClientInstrumentor:
        def instrument(self, *args: Any, **kwargs: Any) -> None:
            return None

    class LoggerProvider:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def add_log_record_processor(self, _processor: Any) -> None:
            return None

    class BatchLogRecordProcessor:
        def __init__(self, _exporter: Any) -> None:
            pass

    class OTLPLogExporter:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

    class LoggingInstrumentor:
        def instrument(self, *args: Any, **kwargs: Any) -> None:
            return None

    class LoggingHandler(logging.Handler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__()

        def emit(self, record: logging.LogRecord) -> None:
            return None
