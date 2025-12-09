# AIO Manager ↔ Edge Communication Strategy

## Overview

This document outlines the recommended communication approach between **AIO Manager** and **Edge** microservices running in the same container on IoT devices.

```
┌─────────────────────────────────────────────────────────┐
│                    Same Container                        │
│  ┌─────────────┐    gRPC + UDS    ┌─────────────┐       │
│  │ AIO Manager │◄────────────────►│    Edge     │       │
│  │  (Client)   │                  │  (Server)   │       │
│  └─────────────┘                  └──────┬──────┘       │
│                                          │              │
└──────────────────────────────────────────┼──────────────┘
                                           │ MQTT/AMQP-WS
                                           ▼
                                    ┌─────────────┐
                                    │    Azure    │
                                    │ DPS/IoT Hub │
                                    └─────────────┘
```

---

## Recommendation

**Use gRPC (Protobuf) over Unix Domain Socket (UDS)**

| Component      | Value                        |
|----------------|------------------------------|
| Protocol       | gRPC with Protobuf           |
| Transport      | Unix Domain Socket (UDS)     |
| Socket Path    | `/var/run/edge-aio.sock`     |
| Fallback       | `127.0.0.1:50051` (TCP)      |

---

## Why gRPC + UDS? (Benefits)

| # | Benefit | Description |
|---|---------|-------------|
| 1 | **Very Low Latency** | UDS bypasses TCP stack; direct kernel IPC |
| 2 | **Low Resource Usage** | Minimal CPU/memory — ideal for IoT devices |
| 3 | **Efficient Binary Encoding** | Protobuf is compact; reduces bandwidth |
| 4 | **Built-in Streaming** | Native bidirectional streaming for telemetry + commands |
| 5 | **Strong Typed Contract** | Protobuf schema prevents breaking changes |
| 6 | **Secure by Default** | File permissions control access; no open ports |
| 7 | **No Extra Processes** | No broker/middleware to manage |
| 8 | **Easy Portability** | Switch to TCP (`127.0.0.1`) for Windows if needed |

---

## Why NOT Other Options?

| Option | Why Not Suitable |
|--------|------------------|
| **REST/HTTP (localhost)** | ❌ JSON overhead, no native streaming, poor for high-frequency telemetry |
| **Local MQTT Broker** | ❌ Adds extra process + memory; overkill for 2 services |
| **Raw TCP/Custom Binary** | ❌ Must build framing, retries, schema, security — high maintenance |
| **WebSocket** | ❌ Less efficient than Protobuf; still need custom message schema |
| **Shared DB/Files** | ❌ High latency; not suitable for real-time commands |
| **Shared Memory (POSIX)** | ❌ Complex, fragile, crash-unsafe — not worth the risk |

---

## Use Cases Supported

| Use Case | gRPC Method Type |
|----------|------------------|
| Mute/Unmute Mic | Unary RPC |
| Get Device Info | Unary RPC |
| Send Commands (batch) | Server Streaming |
| Stream Telemetry | Client/Bidi Streaming |
| Health Check | Unary RPC |

---

## Implementation Summary

### Proto Definition (example)
```protobuf
service ControlService {
  rpc MuteMic(ControlRequest) returns (ControlResponse);
  rpc UnmuteMic(ControlRequest) returns (ControlResponse);
  rpc GetDeviceInfo(Empty) returns (DeviceInfo);
}
```

### Server (Edge) Binding
```typescript
url: 'unix:/var/run/edge-aio.sock'
```

### Client (AIO Manager) Connection
```typescript
url: 'unix:/var/run/edge-aio.sock'
```

---

## Operational Recommendations

| # | Recommendation |
|---|----------------|
| 1 | Remove stale socket file on server startup |
| 2 | Set socket permissions (`chmod 660`) |
| 3 | Add local persistence (SQLite) for offline durability |
| 4 | Expose HTTP health endpoint on `127.0.0.1` for debugging |
| 5 | Support config toggle: UDS path or TCP fallback |

---

## Decision Summary

| Criteria | gRPC + UDS |
|----------|------------|
| Performance | ⭐⭐⭐⭐⭐ |
| Resource Usage | ⭐⭐⭐⭐⭐ |
| Security | ⭐⭐⭐⭐ |
| Maintainability | ⭐⭐⭐⭐⭐ |
| Streaming Support | ⭐⭐⭐⭐⭐ |
| Operational Complexity | Low |

---

## Conclusion

For two co-located microservices (AIO Manager & Edge) on an IoT device requiring:
- Efficient control APIs (mute/unmute, device info)
- Low latency communication
- Typed contracts with versioning
- Minimal resource footprint

**→ gRPC + Protobuf over Unix Domain Socket is the optimal choice.**

---

*Document created: December 2024*
