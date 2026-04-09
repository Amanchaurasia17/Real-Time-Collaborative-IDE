import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as monaco from 'monaco-editor';
import { MonacoBinding } from 'y-monaco';

type Props = {
  roomId: string;
};

const DEFAULT_WS_URL = (import.meta as any).env?.VITE_COLLAB_WS_URL ?? 'ws://localhost:1234/collab';

function randomName() {
  const animals = ['Fox', 'Otter', 'Panda', 'Hawk', 'Koala', 'Tiger', 'Lynx'];
  const adj = ['Quick', 'Calm', 'Bold', 'Sharp', 'Kind', 'Bright', 'Silent'];
  return `${adj[Math.floor(Math.random() * adj.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
}

function getLangFromExt(filename: string) {
  if (filename.endsWith('.cpp')) return 'cpp';
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.js')) return 'javascript';
  if (filename.endsWith('.java')) return 'java';
  if (filename.endsWith('.html')) return 'html';
  if (filename.endsWith('.css')) return 'css';
  return 'typescript';
}

export default function CollaborativeEditor({ roomId }: Props) {
  const editorDivRef = useRef<HTMLDivElement | null>(null);
  
  // Keep refs for Monaco and Yjs objects
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());

  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [onlineUsers, setOnlineUsers] = useState<{ id: number; name: string; color: string; isTyping: boolean }[]>([]);
  const [output, setOutput] = useState<string>('::BOOT_SEQUENCE_INITIALIZED\n::PROTOCOL_LOADED: CRDT_COLLABORATION_v2.1\n::NATIVE_RUNNER: ACTIVE\n> System ready for nodal input.');
  const [isRunning, setIsRunning] = useState(false);

  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string>('main.cpp');
  const [messages, setMessages] = useState<{ sender: string; text: string; color: string; time: string }[]>([]);
  const [chatInput, setChatInput] = useState('');

  const [userName, setUserName] = useState(() => localStorage.getItem('rce-username') || randomName());
  const userColor = useMemo(() => `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`, []);

  // 1. Core Editor Initialization (Once)
  useEffect(() => {
    if (editorDivRef.current) {
      editorRef.current = monaco.editor.create(editorDivRef.current, {
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        theme: 'vs-dark',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontLigatures: true,
        lineHeight: 22,
        padding: { top: 12 },
        readOnly: false
      });
    }

    return () => {
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  // 2. YJS Connection & File Map tracking
  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    
    const provider = new WebsocketProvider(DEFAULT_WS_URL, roomId, ydoc);
    providerRef.current = provider;

    provider.on('status', (event: { status: 'connected' | 'disconnected' }) => {
      setStatus(event.status === 'connected' ? 'connected' : 'disconnected');
    });

    provider.awareness.setLocalStateField('user', {
      name: userName,
      color: userColor,
      isTyping: false
    });

    const updateUsers = () => {
      const states = Array.from(provider.awareness.getStates().entries()) as [number, any][];
      const users = states
        .filter(([, s]) => typeof s?.user?.name === 'string')
        .map(([clientId, s]) => ({
          id: clientId,
          name: s.user.name,
          color: s.user.color || '#2563eb',
          isTyping: !!s.user.isTyping
        }));
      users.sort((a, b) => a.name.localeCompare(b.name));
      setOnlineUsers(users);
    };

    provider.awareness.on('change', updateUsers);
    updateUsers();

    const filesMap = ydoc.getMap('file-structure');
    
    // Listen for file changes over network
    filesMap.observe(() => {
      setFiles(Array.from(filesMap.keys()));
    });
    
    // Populate default files if room is totally new
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        if (Array.from(filesMap.keys()).length === 0) {
          ydoc.transact(() => {
            filesMap.set('main.cpp', true);
            filesMap.set('docs/architecture.md', true);
            filesMap.set('docs/system-design.md', true);

            ydoc.getText('docs/architecture.md').insert(0, `# SYSTEM_ARCHITECTURE::PROTOCOLS\n\n## 1. DATA_CONSISTENCY (CRDT)\nThis IDE uses **Conflict-free Replicated Data Types (CRDTs)** via the Yjs framework. This ensures that concurrent edits across distributed nodes merge mathematically.\n\n## 2. TRANSPORT_LAYER\nWebSocket signals are routed via a specialized relay (y-websocket) that handles binary delta updates.`);
            ydoc.getText('docs/system-design.md').insert(0, `# SYSTEM_DESIGN::ENGINEERING\n\n## 1. VIRTUAL_FILE_SYSTEM (VFS)\nThe VFS is a shared Y.Map where keys represent hierarchical metadata and values represent node types.\n\n## 2. EXECUTION_ISOLATION\nCode execution is handled by a native subsystem using Node.js \`child_process\`.`);
            ydoc.getText('main.cpp').insert(0, `#include <iostream>\n\nint main() {\n    std::cout << "Hello from Realtime IDE!" << std::endl;\n    return 0;\n}`);
          });
          setFiles(['main.cpp', 'docs/architecture.md', 'docs/system-design.md']);
        } else {
          setFiles(Array.from(filesMap.keys()));
        }
      }
    });

    setStatus('connecting');

    // 2. Chat Sync
    const ymessages = ydoc.getArray<{ sender: string; text: string; color: string; time: string }>('messages');
    setMessages(ymessages.toArray());
    const observer = () => setMessages(ymessages.toArray());
    ymessages.observe(observer);

    return () => {
      provider.awareness.off('change', updateUsers);
      ymessages.unobserve(observer);
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      provider.destroy();
      ydoc.destroy();
    };
  }, [roomId, userName]);

  // Handle Remote Cursor Labels (Name Tags)
  useEffect(() => {
    if (!editorRef.current) return;

    const interval = setInterval(() => {
      const heads = document.querySelectorAll('.yRemoteSelectionHead');
      heads.forEach(head => {
        const parent = head.parentElement;
        if (!parent || head.querySelector('.remote-cursor-label')) return;

        // Try to match the color to a user
        const headColor = (head as HTMLElement).style.borderColor;
        // Convert rgb/hex to a safe comparison if needed, but usually exact match works
        const user = onlineUsers.find(u => {
           // Create a temp element to get standardized color format for comparison
           const temp = document.createElement('div');
           temp.style.color = u.color;
           document.body.appendChild(temp);
           const standardized = getComputedStyle(temp).color;
           document.body.removeChild(temp);
           return standardized === headColor;
        });

        if (user) {
          const label = document.createElement('div');
          label.className = 'remote-cursor-label';
          label.innerText = user.name;
          label.style.backgroundColor = user.color;
          head.appendChild(label);
        }
      });
    }, 500);

    return () => clearInterval(interval);
  }, [onlineUsers]);

  // 3. Create Models and Bind Ytext for the active file
  useEffect(() => {
    if (!editorRef.current || !ydocRef.current || !providerRef.current) return;
    if (files.length === 0 || !files.includes(activeFile)) return;

    // Destroy the old binding when swapping tabs, so Y-Monaco only renders cursors/edits into this specific model
    if (bindingRef.current) {
      bindingRef.current.destroy();
    }

    // We keep a registry of MonocoModels so viewing a background tab isn't lost.
    let model = modelsRef.current.get(activeFile);
    const lang = getLangFromExt(activeFile);
    
    if (!model) {
      model = monaco.editor.createModel('', lang);
      modelsRef.current.set(activeFile, model);
    }
    
    editorRef.current.setModel(model);

    const ytext = ydocRef.current.getText(activeFile);
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editorRef.current]), providerRef.current.awareness);

    let typingTimeout: any = null;
    const disposable = editorRef.current.onDidChangeModelContent(() => {
      if (providerRef.current) {
        providerRef.current.awareness.setLocalStateField('user', {
          name: userName,
          color: userColor,
          isTyping: true
        });

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          if (providerRef.current) {
            providerRef.current.awareness.setLocalStateField('user', {
              name: userName,
              color: userColor,
              isTyping: false
            });
          }
        }, 2000);
      }
    });

    return () => {
      disposable.dispose();
      if (typingTimeout) clearTimeout(typingTimeout);
    };

  }, [activeFile, files.length, userName, userColor]);

  const handleEditName = () => {
    const newName = prompt('IDENT_CHANGE::ENTER_NEW_NAME:', userName);
    if (newName && newName.trim() && providerRef.current) {
        const cleanName = newName.trim();
        setUserName(cleanName);
        localStorage.setItem('rce-username', cleanName);
        providerRef.current.awareness.setLocalStateField('user', {
            name: cleanName,
            color: userColor
        });
    }
  };

  const handleAddFile = () => {
    const name = prompt('NEW_FILE_ALLOCATION::ENTER_PATH (e.g., src/lib.js):');
    if (name && name.trim() && ydocRef.current) {
       const cleanPath = name.trim();
       const fileMap = ydocRef.current.getMap('file-structure');
       if (!fileMap.has(cleanPath)) {
           fileMap.set(cleanPath, true);
       }
       setActiveFile(cleanPath);
    }
  };

  const handleAddFolder = () => {
    const name = prompt('NEW_DIRECTORY::ENTER_NAME (e.g., src/utils):');
    if (name && name.trim() && ydocRef.current) {
        const cleanPath = name.trim().endsWith('/') ? name.trim() : `${name.trim()}/`;
        const fileMap = ydocRef.current.getMap('file-structure');
        if (!fileMap.has(cleanPath)) {
            fileMap.set(cleanPath, false); 
        }
    }
  };

  const renderFileTree = () => {
    const root: any = { name: 'project', children: {}, isDir: true, path: '' };
    
    files.forEach(path => {
        const parts = path.split('/').filter(Boolean);
        let current = root;
        let cumulativePath = '';
        parts.forEach((part, i) => {
            cumulativePath += (i === 0 ? '' : '/') + part;
            const isLast = i === parts.length - 1;
            const isDirLocal = !isLast || path.endsWith('/');
            
            if (!current.children[part]) {
                current.children[part] = { 
                    name: part, 
                    children: {}, 
                    isDir: isDirLocal, 
                    path: cumulativePath + (isDirLocal && !isLast ? '/' : '') 
                };
            }
            current = current.children[part];
        });
    });

    const renderNode = (node: any, depth: number) => {
        const sortedChildren = Object.values(node.children).sort((a: any, b: any) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name);
        });

        return (
            <div key={node.path || 'root'} style={{ marginLeft: depth > 0 ? '12px' : '0' }}>
                {depth > 0 && (
                    <div 
                        onClick={() => {
                            if (!node.isDir) setActiveFile(node.path);
                        }}
                        style={{ 
                            cursor: 'pointer',
                            padding: '4px 8px',
                            background: activeFile === node.path ? 'var(--bg-hover)' : 'transparent',
                            color: activeFile === node.path ? 'var(--accent)' : (node.isDir ? 'var(--text-secondary)' : 'var(--text-primary)'),
                            borderRadius: '4px',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                        <span>{node.isDir ? '📁' : '📄'}</span>
                        <span style={{ fontWeight: node.isDir ? 'bold' : 'normal', flex: 1 }}>{node.name}</span>
                        {node.isDir && (
                            <span 
                                title="Add file here"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const fileName = prompt(`NEW_ALLOC_INIT::[${node.path}]::ENTER_FILENAME:`);
                                    if (fileName && fileName.trim()) {
                                        const fullPath = node.path + (node.path.endsWith('/') ? '' : '/') + fileName.trim();
                                        if (ydocRef.current) {
                                            ydocRef.current.getMap('file-structure').set(fullPath, true);
                                            setActiveFile(fullPath);
                                        }
                                    }
                                }}
                                style={{ fontSize: '14px', opacity: 0.5, cursor: 'pointer' }}>
                                +
                            </span>
                        )}
                    </div>
                )}
                <div className="tree-children">
                    {sortedChildren.map((child: any) => renderNode(child, depth + 1))}
                </div>
            </div>
        );
    };

    return renderNode(root, 0);
  };

  return (
    <div className="main">
      <div className="sidebar" style={{ borderRight: '1px solid var(--border)', borderLeft: 'none', padding: '16px', overflowY: 'auto' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
           <strong style={{ letterSpacing: '2px', fontSize: '11px' }}>VIRTUAL_DISK</strong>
           <div style={{ display: 'flex', gap: '8px' }}>
                <button title="New File" onClick={handleAddFile} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>📄+</button>
                <button title="New Folder" onClick={handleAddFolder} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px' }}>📁+</button>
           </div>
         </div>
         {renderFileTree()}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div className="editor" ref={editorDivRef} style={{ flex: 1 }} />
        <div style={{ height: '30%', borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '2px' }}>SYSTEM_LOG::STREAM</strong>
            <button
              onClick={async () => {
                if (!editorRef.current) return;
                setIsRunning(true);
                setOutput('Running...');
                try {
                  const val = editorRef.current.getValue();
                  const baseUrl = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:1234';
                  const res = await fetch(`${baseUrl}/api/run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: val, language: getLangFromExt(activeFile) })
                  });
                  const data = await res.json();
                  setOutput(data.output || data.error);
                } catch (e: any) {
                  setOutput('Execution failed: ' + e.message);
                } finally {
                  setIsRunning(false);
                }
              }}
              disabled={isRunning}
              style={{
                background: isRunning ? 'var(--bg-tertiary)' : 'var(--success)', 
                color: isRunning ? 'var(--text-muted)' : '#0d1117', 
                border: 'none', 
                padding: '6px 14px', 
                borderRadius: '6px', 
                cursor: isRunning ? 'wait' : 'pointer', 
                fontSize: '12px', 
                fontWeight: 600,
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isRunning ? (
                <>
                  <span className="spinner"></span>
                  Running...
                </>
              ) : (
                '▶ Run Code'
              )}
            </button>
          </div>
          <div style={{ padding: '12px 16px', overflow: 'auto', flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: '12px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {output}
          </div>
        </div>
      </div>
      <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%', borderLeft: '1px solid var(--border)', padding: '16px' }}>
        <div>
          <strong>NETWORK_STATUS</strong>
          <div className="small">{DEFAULT_WS_URL}</div>
          <div className="badge mt6">
            [{status.toUpperCase()}]
          </div>
        </div>
        <div className="mt16">
          <strong>ACTIVE_NODES</strong>
          <div className="small">[{onlineUsers.length.toString().padStart(2, '0')}]</div>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: '8px' }}>
            {onlineUsers.map((u) => (
              <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', marginBottom: '4px' }}>
                <span className="user-color-dot" style={{ backgroundColor: u.color, width: 8, height: 8, borderRadius: '50%', flexShrink: 0, boxShadow: `0 0 6px ${u.color}` }} />
                {u.name}
                {u.isTyping && <span style={{ fontSize: '9px', color: 'var(--success)', fontStyle: 'italic' }}>typing...</span>}
                {u.id === ydocRef.current?.clientID && (
                    <span 
                      onClick={handleEditName}
                      style={{ fontSize: '9px', color: 'var(--text-muted)', cursor: 'pointer', textDecoration: 'underline' }}>
                      [EDIT]
                    </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt16" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <strong style={{ letterSpacing: '2px' }}>COMM_LINK::RELAY</strong>
            <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border)', marginTop: '8px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {messages.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '11px', opacity: 0.5 }}>SIGNAL_VOID: NO_INCOMING_DATA</div>}
                {messages.map((m, i) => (
                    <div key={i} style={{ fontSize: '11px', borderLeft: `2px solid ${m.color}`, paddingLeft: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.7, marginBottom: '2px' }}>
                            <span style={{ color: m.color, fontWeight: 'bold' }}>{m.sender.toUpperCase()}</span>
                            <span>{m.time}</span>
                        </div>
                        <div style={{ wordBreak: 'break-word', color: 'var(--text-primary)' }}>{m.text}</div>
                    </div>
                ))}
            </div>
            <form onSubmit={(e) => {
                e.preventDefault();
                if (!chatInput.trim() || !ydocRef.current) return;
                const ymessages = ydocRef.current.getArray('messages');
                ymessages.push([{ 
                    sender: userName, 
                    text: chatInput.trim(), 
                    color: userColor, 
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) 
                }]);
                setChatInput('');
            }} style={{ marginTop: '8px', display: 'flex' }}>
                <input 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="MSG_SIGNAL..."
                    onFocus={() => {
                        // Optional: can add specific focus styling here if needed
                    }}
                    style={{ 
                        flex: 1, 
                        background: 'var(--bg-secondary)', 
                        border: '1px solid var(--border)', 
                        color: 'var(--text-primary)', 
                        fontSize: '11px',
                        padding: '6px 10px',
                        outline: 'none',
                        fontFamily: 'var(--font-mono)',
                        borderRight: 'none'
                    }}
                />
                <button type="submit" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: '10px', padding: '0 8px', cursor: 'pointer' }}>SEND</button>
            </form>
        </div>
      </div>
    </div>
  );
}
