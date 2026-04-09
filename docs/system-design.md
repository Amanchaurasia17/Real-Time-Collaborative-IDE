# System Design

This documentation provides an deep overview of the system's architecture, constraints, scaling strategy, and security considerations.

## 1. Scope & MVP Goals
The current version is an MVP (Minimum Viable Product) optimized for single-instance high-concurrency pair programming.

### Current Goals
- Real-time CRDT-based synchronization.
- Persistent room state via local storage.
- Anonymous, friction-free access.

### Non-Goals (Incremental Improvements)
- Centralized RBAC (Role Based Access Control).
- Multi-region horizontal scalability.
- Guaranteed delivery during network partition.

## 2. Persistence Model
The system uses a **per-room persistence model** to ensure that code is never lost on server restarts.

### Components
- **Mechanism**: `y-leveldb` (an append-only binary store).
- **Storage**: Yjs binary updates are keyed by `roomId`.
- **Logic**: On first join, the server reconstructs the `Y.Doc` from the update log. Subsequent edits are appended in real-time.

### Improvements (Production Grade)
- Swap LevelDB for **S3 snapshots** + **Redis stream log** for multi-instance clusters.
- Add compaction logic to merge update logs into full state snapshots periodically.

## 3. Scaling & Engineering
Scaling a stateful collaborative system requires careful management of connection fan-out and memory.

### Bottlenecks
- **Fan-out**: Large rooms (20+ users) cause O(n²) broadcast load.
- **Memory**: Each active room maintains an in-memory document state.
- **I/O**: Frequent writes to LevelDB under high-load typing.

### Strategy
- **Room Sharding**: Use sticky sessions or consistent hashing to route `roomId` → `shardAddr`.
- **Horizontal Scaling**: Edge nodes route traffic to stateful shard nodes that own specific room instances.
- **Edge Cache (Presence)**: Move ephemeral awareness data to the edge or in-memory only.

## 4. Security & Abuse Prevention
By default, the IDE is open. Hardening is required for production deployment.

### Recommended Controls
- **Transport**: Enforce `wss://` with TLS termination at a reverse proxy.
- **Authentication**: Integrate JWT-based room entry tokens and signed invite links.
- **Rate Limiting**: Throttling per IP for connection attempts and per connection for update messages.
- **Input Validation**: Max `roomId` lengths and WebSocket message size caps to prevent memory exhaustion attacks.

## 5. Observability
Visibility into the health of the system is tracked through:
- **Metrics**: Active connections, per-room fan-out metrics, and persistence write latencies.
- **Logs**: Lifecycle events for WebSocket handshakes and LevelDB compaction cycles.
- **Health Checks**: `/healthz` endpoint for monitoring infrastructure readiness.
