import { useMemo, useState } from 'react';
import CollaborativeEditor from './editor/CollaborativeEditor';

function getInitialRoomId(): string {
  const url = new URL(window.location.href);
  return url.searchParams.get('room') ?? 'demo';
}

export default function App() {
  const [roomId, setRoomId] = useState(getInitialRoomId());
  const [draftRoomId, setDraftRoomId] = useState(roomId);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
  }, [roomId]);

  const joinRoom = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const nextRoom = draftRoomId.trim() || 'demo';
    setRoomId(nextRoom);

    const url = new URL(window.location.href);
    url.searchParams.set('room', nextRoom);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="app">
      <div className="header">
        <strong>Realtime Collab Editor</strong>
        <span className="badge">room: {roomId}</span>
        <form className="header-form" onSubmit={joinRoom} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label className="small">
            Room
            <input
              className="ml8"
              value={draftRoomId}
              onChange={(e) => setDraftRoomId(e.target.value)}
            />
          </label>
          <button type="submit">
            Join
          </button>
        </form>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(shareUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <span className="small">Share the link to collaborate.</span>
      </div>

      <CollaborativeEditor roomId={roomId} />
    </div>
  );
}
