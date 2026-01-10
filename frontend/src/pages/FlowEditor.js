import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  useReactFlow,
  ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useApp } from '../context/AppContext';

// Custom node components
import TriggerNode from '../components/flow/nodes/TriggerNode';
import ButtonPressNode from '../components/flow/nodes/ButtonPressNode';
import ActionNode from '../components/flow/nodes/ActionNode';
import ConditionNode from '../components/flow/nodes/ConditionNode';
import BranchNode from '../components/flow/nodes/BranchNode';
import DelayNode from '../components/flow/nodes/DelayNode';
import PlayerChoiceNode from '../components/flow/nodes/PlayerChoiceNode';
import SimpleABNode from '../components/flow/nodes/SimpleABNode';

import './FlowEditor.css';

const nodeTypes = {
  trigger: TriggerNode,
  button_press: ButtonPressNode,
  action: ActionNode,
  condition: ConditionNode,
  branch: BranchNode,
  delay: DelayNode,
  player_choice: PlayerChoiceNode,
  simple_ab: SimpleABNode
};

const NODE_TEMPLATES = {
  trigger: {
    first_message: { label: 'First Chat Message', triggerType: 'first_message' },
    device_on: { label: 'Device Turns On', triggerType: 'device_on', device: '' },
    device_off: { label: 'Device Turns Off', triggerType: 'device_off', device: '' },
    player_speaks: { label: 'Player Speaks', triggerType: 'player_speaks', keywords: [''] },
    ai_speaks: { label: 'AI Speaks', triggerType: 'ai_speaks', keywords: [''] },
    timer: { label: 'Timer', triggerType: 'timer', delay: 60, repeat: false },
    random: { label: 'Random', triggerType: 'random', probability: 50 },
    idle: { label: 'Idle', triggerType: 'idle', threshold: 300 },
    player_state_change: {
      label: 'Player State Change',
      triggerType: 'player_state_change',
      stateType: 'capacity',
      comparison: 'meet',
      targetValue: 50,
      fireOnlyOnce: true,
      hasPriority: false,
      priority: 5
    },
    new_session: {
      label: 'New Session',
      triggerType: 'new_session'
    }
  },
  button_press: {
    default: { label: '' }
  },
  action: {
    send_message: { label: 'Send AI Message', actionType: 'send_message', message: '', suppressLlm: false },
    send_player_message: { label: 'Send Player Message', actionType: 'send_player_message', message: '', suppressLlm: false },
    system_message: { label: 'System Message', actionType: 'system_message', message: '' },
    device_on: { label: 'Turn Device On', actionType: 'device_on', device: '', untilType: 'forever', untilOperator: '>', untilValue: null },
    device_off: { label: 'Turn Device Off', actionType: 'device_off', device: '' },
    start_cycle: { label: 'Start Cycle', actionType: 'start_cycle', device: '', duration: 5, interval: 10, cycles: 0, untilType: 'forever', untilValue: null },
    stop_cycle: { label: 'Stop Cycle', actionType: 'stop_cycle', device: '' },
    declare_variable: { label: 'Declare Variable', actionType: 'declare_variable', name: '', value: '' },
    set_variable: { label: 'Set Variable', actionType: 'set_variable', varType: 'system', variable: '', value: '' },
    toggle_reminder: { label: 'Toggle Reminder', actionType: 'toggle_reminder', reminderId: '', action: 'enable', newText: '' },
    toggle_button: { label: 'Toggle Button', actionType: 'toggle_button', buttonId: '', action: 'enable' }
  },
  condition: {
    default: {
      label: 'Condition',
      conditions: [
        { variable: 'capacity', operator: '>', value: 50, value2: null, onlyOnce: false }
      ]
    }
  },
  branch: {
    conditional: { label: 'Conditional Branch', branchType: 'conditional', conditions: [] },
    random: { label: 'Random Branch', branchType: 'random', branches: [] }
  },
  delay: {
    default: { label: 'Delay', duration: 5, unit: 'seconds' }
  },
  player_choice: {
    default: {
      label: 'Player Choice',
      prompt: '',
      description: '',
      choices: [
        { id: 'choice-1', label: 'Option A', description: '' },
        { id: 'choice-2', label: 'Option B', description: '' }
      ]
    }
  },
  simple_ab: {
    default: {
      label: 'Simple A/B',
      description: '',
      labelA: 'Option A',
      descriptionA: '',
      labelB: 'Option B',
      descriptionB: ''
    }
  }
};

let nodeId = 0;
const getId = () => `node_${nodeId++}`;

function FlowEditor() {
  const { flows, api, devices, settings, characters } = useApp();

  // Get reminders and buttons for flow nodes
  const globalReminders = settings?.globalReminders || [];
  const activeCharacter = characters?.find(c => c.id === settings?.activeCharacterId);
  const characterReminders = activeCharacter?.constantReminders || [];
  const characterButtons = activeCharacter?.buttons || [];

  // Extract all declared flow variable names from Declare Variable actions across all flows
  const flowVariables = useMemo(() => {
    const variableNames = new Set();
    (flows || []).forEach(flow => {
      (flow.nodes || []).forEach(node => {
        if (node.type === 'action' && node.data?.actionType === 'declare_variable' && node.data?.name) {
          // Variable names are stored without the [Flow:] wrapper
          variableNames.add(node.data.name);
        }
      });
    });
    return Array.from(variableNames).sort();
  }, [flows]);
  const reactFlowWrapper = useRef(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [flowName, setFlowName] = useState('');
  const [flowCategory, setFlowCategory] = useState('character');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [hasDraft, setHasDraft] = useState(false);
  const draftInitialized = useRef(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null);
  const [clipboard, setClipboard] = useState(null); // Can hold single node or array of nodes
  const [selectedNodeIds, setSelectedNodeIds] = useState([]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle node data updates
  const updateNodeData = useCallback((nodeId, field, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              [field]: value
            }
          };
        }
        return node;
      })
    );
  }, [setNodes]);

  // Context menu handlers
  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopyNode = useCallback(() => {
    if (!contextMenu) return;
    const node = nodes.find(n => n.id === contextMenu.nodeId);
    if (node) {
      // Strip out the onChange handler and devices before copying
      const { onChange, devices: _devices, ...cleanData } = node.data;
      setClipboard({
        type: node.type,
        data: cleanData
      });
    }
    closeContextMenu();
  }, [contextMenu, nodes, closeContextMenu]);

  const handlePasteNode = useCallback(() => {
    if (!clipboard || !reactFlowInstance) {
      closeContextMenu();
      return;
    }

    // Get position from context menu or center of viewport
    const position = contextMenu
      ? reactFlowInstance.screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })
      : { x: 100, y: 100 };

    const newNodeId = getId();
    const newNode = {
      id: newNodeId,
      type: clipboard.type,
      position: { x: position.x + 20, y: position.y + 20 },
      data: {
        ...clipboard.data,
        devices,
        globalReminders,
        characterReminders,
        characterButtons,
        flowVariables,
        onChange: (field, value) => updateNodeData(newNodeId, field, value)
      }
    };

    setNodes((nds) => nds.concat(newNode));
    closeContextMenu();
  }, [clipboard, contextMenu, reactFlowInstance, devices, globalReminders, characterReminders, characterButtons, flowVariables, updateNodeData, setNodes, closeContextMenu]);

  const handleUnlinkAll = useCallback(() => {
    if (!contextMenu) return;
    setEdges((eds) => eds.filter(e => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId));
    closeContextMenu();
  }, [contextMenu, setEdges, closeContextMenu]);

  const handleDeleteNode = useCallback(() => {
    if (!contextMenu) return;
    setNodes((nds) => nds.filter(n => n.id !== contextMenu.nodeId));
    setEdges((eds) => eds.filter(e => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId));
    closeContextMenu();
  }, [contextMenu, setNodes, setEdges, closeContextMenu]);

  // Close context menu when clicking elsewhere
  const onPaneClick = useCallback(() => {
    closeContextMenu();
  }, [closeContextMenu]);

  // Track selection changes
  const onSelectionChange = useCallback(({ nodes: selectedNodes }) => {
    setSelectedNodeIds(selectedNodes.map(n => n.id));
  }, []);

  // Copy selected nodes (multiple)
  const handleCopySelected = useCallback(() => {
    const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
    if (selectedNodes.length === 0) return;

    const copiedNodes = selectedNodes.map(node => {
      const { onChange, devices: _devices, ...cleanData } = node.data;
      return {
        id: node.id, // Keep original ID for edge mapping
        type: node.type,
        data: cleanData,
        position: { ...node.position }
      };
    });

    // Also copy edges between selected nodes
    const copiedEdges = edges.filter(e =>
      selectedNodeIds.includes(e.source) && selectedNodeIds.includes(e.target)
    );

    setClipboard({ nodes: copiedNodes, edges: copiedEdges, isMultiple: true });
    closeContextMenu();
  }, [nodes, edges, selectedNodeIds, closeContextMenu]);

  // Delete selected nodes
  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    setNodes((nds) => nds.filter(n => !selectedNodeIds.includes(n.id)));
    setEdges((eds) => eds.filter(e => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)));
    setSelectedNodeIds([]);
    closeContextMenu();
  }, [selectedNodeIds, setNodes, setEdges, closeContextMenu]);

  // Paste (handles both single and multiple nodes)
  const handlePaste = useCallback(() => {
    if (!clipboard || !reactFlowInstance) {
      closeContextMenu();
      return;
    }

    const position = contextMenu
      ? reactFlowInstance.screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })
      : { x: 100, y: 100 };

    if (clipboard.isMultiple) {
      // Paste multiple nodes
      const idMap = {};
      const minX = Math.min(...clipboard.nodes.map(n => n.position.x));
      const minY = Math.min(...clipboard.nodes.map(n => n.position.y));

      const newNodes = clipboard.nodes.map(node => {
        const newNodeId = getId();
        idMap[node.id] = newNodeId;
        return {
          id: newNodeId,
          type: node.type,
          position: {
            x: position.x + (node.position.x - minX) + 20,
            y: position.y + (node.position.y - minY) + 20
          },
          data: {
            ...node.data,
            devices,
            globalReminders,
            characterReminders,
            characterButtons,
            flowVariables,
            onChange: (field, value) => updateNodeData(newNodeId, field, value)
          }
        };
      });

      // Recreate edges with new IDs
      const newEdges = clipboard.edges.map(edge => ({
        ...edge,
        id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: idMap[edge.source] || edge.source,
        target: idMap[edge.target] || edge.target
      }));

      setNodes((nds) => nds.concat(newNodes));
      setEdges((eds) => eds.concat(newEdges));
    } else {
      // Single node paste (legacy)
      const newNodeId = getId();
      const newNode = {
        id: newNodeId,
        type: clipboard.type,
        position: { x: position.x + 20, y: position.y + 20 },
        data: {
          ...clipboard.data,
          devices,
          globalReminders,
          characterReminders,
          characterButtons,
          flowVariables,
          onChange: (field, value) => updateNodeData(newNodeId, field, value)
        }
      };
      setNodes((nds) => nds.concat(newNode));
    }
    closeContextMenu();
  }, [clipboard, contextMenu, reactFlowInstance, devices, globalReminders, characterReminders, characterButtons, flowVariables, updateNodeData, setNodes, setEdges, closeContextMenu]);

  // Organize/Auto-layout nodes
  const handleOrganizeNodes = useCallback(() => {
    if (nodes.length === 0) return;

    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 150;
    const HORIZONTAL_GAP = 80;
    const VERTICAL_GAP = 100;

    // Build adjacency list
    const children = {};
    const parents = {};
    nodes.forEach(n => {
      children[n.id] = [];
      parents[n.id] = [];
    });
    edges.forEach(e => {
      if (children[e.source]) children[e.source].push(e.target);
      if (parents[e.target]) parents[e.target].push(e.source);
    });

    // Find root nodes (triggers/no parents)
    const roots = nodes.filter(n =>
      n.type === 'trigger' || n.type === 'button_press' || parents[n.id].length === 0
    );

    // BFS to assign levels
    const levels = {};
    const visited = new Set();
    let queue = roots.map(n => ({ id: n.id, level: 0 }));

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      levels[id] = Math.max(levels[id] || 0, level);

      children[id].forEach(childId => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, level: level + 1 });
        }
      });
    }

    // Handle unvisited nodes (disconnected)
    nodes.forEach(n => {
      if (!visited.has(n.id)) {
        levels[n.id] = 0;
      }
    });

    // Group nodes by level
    const levelGroups = {};
    Object.entries(levels).forEach(([id, level]) => {
      if (!levelGroups[level]) levelGroups[level] = [];
      levelGroups[level].push(id);
    });

    // Position nodes
    const newPositions = {};
    Object.entries(levelGroups).forEach(([level, nodeIds]) => {
      const y = parseInt(level) * (NODE_HEIGHT + VERTICAL_GAP);
      const totalWidth = nodeIds.length * NODE_WIDTH + (nodeIds.length - 1) * HORIZONTAL_GAP;
      const startX = -totalWidth / 2;

      nodeIds.forEach((nodeId, index) => {
        newPositions[nodeId] = {
          x: startX + index * (NODE_WIDTH + HORIZONTAL_GAP),
          y: y
        };
      });
    });

    // Update nodes with new positions
    setNodes((nds) => nds.map(node => ({
      ...node,
      position: newPositions[node.id] || node.position
    })));

    // Fit view after organizing
    setTimeout(() => {
      if (reactFlowInstance) {
        reactFlowInstance.fitView({ padding: 0.2 });
      }
    }, 50);
  }, [nodes, edges, setNodes, reactFlowInstance]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Only handle if focus is on the flow canvas area
      const target = event.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      // Ctrl+C - Copy
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          handleCopySelected();
        }
      }

      // Ctrl+V - Paste
      if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
        if (clipboard && reactFlowInstance) {
          event.preventDefault();
          // Paste at center of screen
          setContextMenu({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            paneOnly: true
          });
          setTimeout(() => handlePaste(), 0);
        }
      }

      // Delete or Backspace - Delete selected
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          handleDeleteSelected();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeIds, clipboard, reactFlowInstance, handleCopySelected, handlePaste, handleDeleteSelected]);

  // Right-click on empty pane for paste
  const onPaneContextMenu = useCallback((event) => {
    event.preventDefault();
    // Show paste option if we have clipboard content
    if (clipboard) {
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: null,
        paneOnly: true
      });
    }
  }, [clipboard]);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow/type');
      const subtype = event.dataTransfer.getData('application/reactflow/subtype');

      if (!type) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      });

      const template = NODE_TEMPLATES[type]?.[subtype] || NODE_TEMPLATES[type]?.default || { label: type };

      const nodeId = getId();
      const newNode = {
        id: nodeId,
        type,
        position,
        data: {
          ...template,
          devices,
          globalReminders,
          characterReminders,
          characterButtons,
          flowVariables,
          onChange: (field, value) => updateNodeData(nodeId, field, value)
        }
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes, devices, globalReminders, characterReminders, characterButtons, flowVariables, updateNodeData]
  );

  const onDragStart = (event, nodeType, subtype) => {
    event.dataTransfer.setData('application/reactflow/type', nodeType);
    event.dataTransfer.setData('application/reactflow/subtype', subtype);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleSaveFlow = async () => {
    if (!flowName.trim()) return;

    const flowData = {
      name: flowName,
      category: flowCategory,
      nodes: nodes,
      edges: edges,
      isActive: false
    };

    try {
      if (selectedFlow) {
        await api.updateFlow(selectedFlow.id, flowData);
      } else {
        await api.createFlow(flowData);
      }
      // Clear draft on successful save
      clearFlowDraft();
      setShowSaveModal(false);
    } catch (error) {
      console.error('Failed to save flow:', error);
    }
  };

  const handleLoadFlow = useCallback((flow) => {
    // Reset draft state when loading a new flow
    draftInitialized.current = false;
    setHasDraft(false);

    setSelectedFlow(flow);
    setFlowName(flow.name);
    setFlowCategory(flow.category || 'character');

    // Save to localStorage for persistence
    localStorage.setItem('lastFlowId', flow.id);

    // Update nodeId counter to avoid ID conflicts
    // Find the highest node ID number in the loaded flow
    if (flow.nodes && flow.nodes.length > 0) {
      const maxId = flow.nodes.reduce((max, node) => {
        const match = node.id.match(/^node_(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          return num > max ? num : max;
        }
        return max;
      }, -1);
      nodeId = maxId + 1;
      console.log('[FlowEditor] Updated nodeId counter to:', nodeId);
    }

    // Add onChange handler to loaded nodes
    const nodesWithHandlers = (flow.nodes || []).map(node => ({
      ...node,
      data: {
        ...node.data,
        devices,
        globalReminders,
        characterReminders,
        characterButtons,
        flowVariables,
        onChange: (field, value) => updateNodeData(node.id, field, value)
      }
    }));

    setNodes(nodesWithHandlers);
    setEdges(flow.edges || []);
    setShowLoadModal(false);
  }, [devices, globalReminders, characterReminders, characterButtons, flowVariables, updateNodeData, setNodes, setEdges]);

  const handleNewFlow = () => {
    // Reset draft state
    draftInitialized.current = false;
    setHasDraft(false);

    setSelectedFlow(null);
    setFlowName('');
    setFlowCategory('character');
    setNodes([]);
    setEdges([]);
    // Reset nodeId counter for new flow
    nodeId = 0;
    // Clear last flow from localStorage
    localStorage.removeItem('lastFlowId');
  };

  // Auto-load last worked-on flow when component mounts
  useEffect(() => {
    const lastFlowId = localStorage.getItem('lastFlowId');
    if (lastFlowId && flows && flows.length > 0 && !selectedFlow) {
      const flow = flows.find(f => f.id === lastFlowId);
      if (flow) {
        console.log('[FlowEditor] Auto-loading last flow:', flow.name);
        handleLoadFlow(flow);
      }
    }
  }, [flows, handleLoadFlow, selectedFlow]);

  // Draft persistence - get draft key based on current flow
  const getDraftKey = useCallback(() => {
    return selectedFlow ? `flow-draft-${selectedFlow.id}` : 'flow-draft-new';
  }, [selectedFlow]);

  // Auto-save draft to sessionStorage (debounced)
  useEffect(() => {
    if (!draftInitialized.current) return;

    const timeoutId = setTimeout(() => {
      const draftKey = getDraftKey();
      // Strip onChange handlers from nodes before saving
      const cleanNodes = nodes.map(node => {
        const { onChange, devices: _d, globalReminders: _gr, characterReminders: _cr, characterButtons: _cb, flowVariables: _fv, ...cleanData } = node.data;
        return { ...node, data: cleanData };
      });
      const draft = {
        nodes: cleanNodes,
        edges,
        flowName,
        flowCategory,
        timestamp: Date.now()
      };
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [nodes, edges, flowName, flowCategory, getDraftKey]);

  // Check for draft when flow selection changes
  useEffect(() => {
    const draftKey = getDraftKey();
    const savedDraft = sessionStorage.getItem(draftKey);

    if (savedDraft && !draftInitialized.current) {
      try {
        const draft = JSON.parse(savedDraft);
        // Only restore if draft is newer than 1 hour
        if (draft.timestamp && Date.now() - draft.timestamp < 3600000) {
          // Restore draft
          const nodesWithHandlers = draft.nodes.map(node => ({
            ...node,
            data: {
              ...node.data,
              devices,
              globalReminders,
              characterReminders,
              characterButtons,
              flowVariables,
              onChange: (field, value) => updateNodeData(node.id, field, value)
            }
          }));
          setNodes(nodesWithHandlers);
          setEdges(draft.edges || []);
          if (draft.flowName) setFlowName(draft.flowName);
          if (draft.flowCategory) setFlowCategory(draft.flowCategory);
          setHasDraft(true);
          console.log('[FlowEditor] Restored draft from session');
        }
      } catch (e) {
        console.error('[FlowEditor] Failed to parse draft:', e);
      }
    }
    draftInitialized.current = true;
  }, [selectedFlow, getDraftKey, devices, globalReminders, characterReminders, characterButtons, flowVariables, updateNodeData, setNodes, setEdges]);

  // Clear draft on successful save
  const clearFlowDraft = useCallback(() => {
    const draftKey = getDraftKey();
    sessionStorage.removeItem(draftKey);
    setHasDraft(false);
  }, [getDraftKey]);

  const handleDeleteFlow = async (flowId) => {
    if (window.confirm('Delete this flow?')) {
      try {
        await api.deleteFlow(flowId);
        if (selectedFlow?.id === flowId) {
          handleNewFlow();
        }
      } catch (error) {
        console.error('Failed to delete flow:', error);
      }
    }
  };

  return (
    <div className="flow-editor-page">
      {/* Sidebar - Node Palette */}
      <div className="flow-sidebar">
        <div className="sidebar-section">
          <h3>Flows</h3>
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <button
              className="btn btn-primary"
              onClick={handleNewFlow}
              style={{ flex: 1 }}
            >
              New
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowLoadModal(true)}
              style={{ flex: 1 }}
            >
              Load
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Triggers</h3>
          <div className="node-palette">
            {Object.entries(NODE_TEMPLATES.trigger).map(([key, template]) => (
              <div
                key={key}
                className="palette-node trigger"
                draggable
                onDragStart={(e) => onDragStart(e, 'trigger', key)}
              >
                {template.label}
              </div>
            ))}
            <div
              className="palette-node trigger"
              draggable
              onDragStart={(e) => onDragStart(e, 'button_press', 'default')}
            >
              Button Press
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Actions</h3>
          <div className="node-palette">
            {Object.entries(NODE_TEMPLATES.action).map(([key, template]) => (
              <div
                key={key}
                className="palette-node action"
                draggable
                onDragStart={(e) => onDragStart(e, 'action', key)}
              >
                {template.label}
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Logic</h3>
          <div className="node-palette">
            <div
              className="palette-node condition"
              draggable
              onDragStart={(e) => onDragStart(e, 'condition', 'default')}
            >
              Condition
            </div>
            <div
              className="palette-node branch"
              draggable
              onDragStart={(e) => onDragStart(e, 'branch', 'conditional')}
            >
              Conditional Branch
            </div>
            <div
              className="palette-node branch"
              draggable
              onDragStart={(e) => onDragStart(e, 'branch', 'random')}
            >
              Random Branch
            </div>
            <div
              className="palette-node player-choice"
              draggable
              onDragStart={(e) => onDragStart(e, 'player_choice', 'default')}
            >
              Player Choice
            </div>
            <div
              className="palette-node simple-ab"
              draggable
              onDragStart={(e) => onDragStart(e, 'simple_ab', 'default')}
            >
              Simple A/B
            </div>
            <div
              className="palette-node delay"
              draggable
              onDragStart={(e) => onDragStart(e, 'delay', 'default')}
            >
              Delay
            </div>
          </div>
        </div>
      </div>

      {/* Main Canvas */}
      <div className="flow-canvas" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onSelectionChange={onSelectionChange}
          nodeTypes={nodeTypes}
          selectionOnDrag
          selectionMode="partial"
          panOnDrag={[1, 2]}
          fitView
        >
          <Controls />
          <MiniMap />
          <Background variant="dots" gap={12} size={1} />
          <Panel position="top-right">
            <div className="canvas-toolbar">
              {hasDraft && (
                <span className="draft-indicator" title="Unsaved changes restored from previous session">
                  Draft restored
                </span>
              )}
              <button
                className="btn btn-secondary"
                onClick={handleOrganizeNodes}
                title="Auto-arrange nodes"
              >
                Organize
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setShowSaveModal(true)}
              >
                Save Flow
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Node Context Menu */}
      {contextMenu && (
        <div
          className="node-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.paneOnly ? (
            // Pane-only context menu (just paste)
            <button onClick={handlePaste}>
              <span className="menu-icon">📄</span> Paste {clipboard?.isMultiple ? `(${clipboard.nodes.length})` : ''}
            </button>
          ) : selectedNodeIds.length > 1 ? (
            // Multi-select context menu
            <>
              <button onClick={handleCopySelected}>
                <span className="menu-icon">📋</span> Copy ({selectedNodeIds.length})
              </button>
              <button onClick={handlePaste} disabled={!clipboard}>
                <span className="menu-icon">📄</span> Paste
              </button>
              <div className="menu-divider" />
              <button onClick={handleDeleteSelected} className="delete">
                <span className="menu-icon">🗑️</span> Delete ({selectedNodeIds.length})
              </button>
            </>
          ) : (
            // Single node context menu
            <>
              <button onClick={handleCopyNode}>
                <span className="menu-icon">📋</span> Copy
              </button>
              <button onClick={handlePaste} disabled={!clipboard}>
                <span className="menu-icon">📄</span> Paste
              </button>
              <div className="menu-divider" />
              <button onClick={handleUnlinkAll}>
                <span className="menu-icon">🔗</span> Unlink All
              </button>
              <button onClick={handleDeleteNode} className="delete">
                <span className="menu-icon">🗑️</span> Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedFlow ? 'Update Flow' : 'Save Flow'}</h3>
              <button className="modal-close" onClick={() => setShowSaveModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Flow Name</label>
                <input
                  type="text"
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  placeholder="Enter flow name..."
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select
                  value={flowCategory}
                  onChange={(e) => setFlowCategory(e.target.value)}
                >
                  <option value="persona">Persona</option>
                  <option value="character">Character</option>
                  <option value="global">Global</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveFlow}
                disabled={!flowName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Load Flow</h3>
              <button className="modal-close" onClick={() => setShowLoadModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {flows.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  No flows available. Create a new flow to get started.
                </p>
              ) : (
                <div className="flow-list-modal">
                  {flows.map((flow) => (
                    <div key={flow.id} className="flow-item-modal">
                      <div className="flow-item-info" onClick={() => handleLoadFlow(flow)}>
                        <div className="flow-item-name">{flow.name}</div>
                        <div className="flow-item-category">
                          {flow.category || 'character'}
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFlow(flow.id);
                        }}
                        title="Delete flow"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowLoadModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowEditor;
