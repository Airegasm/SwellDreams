import { useState, useCallback, useRef } from 'react';

/**
 * Custom hook for undo/redo functionality in the Flow Editor.
 * Maintains a history stack of node/edge states with configurable depth.
 *
 * @param {number} maxHistory - Maximum number of history entries to keep (default: 50)
 * @returns {object} - { pushSnapshot, undo, redo, canUndo, canRedo, clearHistory }
 */
export function useFlowHistory(maxHistory = 50) {
  // History stacks: past actions and future (for redo)
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  // Track if we're currently undoing/redoing to prevent recording those as new history
  const isUndoingRef = useRef(false);

  /**
   * Push a new snapshot to history
   * Call this BEFORE making changes to capture the "before" state
   *
   * @param {Array} nodes - Current nodes array
   * @param {Array} edges - Current edges array
   * @param {string} actionName - Description of the action (for debugging)
   */
  const pushSnapshot = useCallback((nodes, edges, actionName = 'action') => {
    // Don't record history during undo/redo operations
    if (isUndoingRef.current) return;

    // Create a clean copy of the state (strip any React-specific properties)
    const snapshot = {
      nodes: nodes.map(node => ({
        id: node.id,
        type: node.type,
        position: { ...node.position },
        data: { ...node.data },
        ...(node.width && { width: node.width }),
        ...(node.height && { height: node.height }),
        ...(node.selected !== undefined && { selected: node.selected })
      })),
      edges: edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        ...(edge.animated !== undefined && { animated: edge.animated }),
        ...(edge.type && { type: edge.type })
      })),
      actionName,
      timestamp: Date.now()
    };

    setPast(prevPast => {
      const newPast = [...prevPast, snapshot];
      // Trim to max history size
      if (newPast.length > maxHistory) {
        return newPast.slice(newPast.length - maxHistory);
      }
      return newPast;
    });

    // Clear future when new action is taken (can't redo after new changes)
    setFuture([]);
  }, [maxHistory]);

  /**
   * Undo the last action
   * Returns the previous state to restore, or null if nothing to undo
   *
   * @param {Array} currentNodes - Current nodes to save to future
   * @param {Array} currentEdges - Current edges to save to future
   * @returns {object|null} - { nodes, edges } to restore, or null
   */
  const undo = useCallback((currentNodes, currentEdges) => {
    if (past.length === 0) return null;

    isUndoingRef.current = true;

    const previousState = past[past.length - 1];

    // Save current state to future for redo
    const currentSnapshot = {
      nodes: currentNodes.map(node => ({
        id: node.id,
        type: node.type,
        position: { ...node.position },
        data: { ...node.data },
        ...(node.width && { width: node.width }),
        ...(node.height && { height: node.height })
      })),
      edges: currentEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        ...(edge.animated !== undefined && { animated: edge.animated }),
        ...(edge.type && { type: edge.type })
      })),
      actionName: 'undo',
      timestamp: Date.now()
    };

    setPast(prevPast => prevPast.slice(0, -1));
    setFuture(prevFuture => [...prevFuture, currentSnapshot]);

    // Reset the flag after a short delay to allow state updates
    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    return previousState;
  }, [past]);

  /**
   * Redo the last undone action
   * Returns the state to restore, or null if nothing to redo
   *
   * @param {Array} currentNodes - Current nodes to save to past
   * @param {Array} currentEdges - Current edges to save to past
   * @returns {object|null} - { nodes, edges } to restore, or null
   */
  const redo = useCallback((currentNodes, currentEdges) => {
    if (future.length === 0) return null;

    isUndoingRef.current = true;

    const nextState = future[future.length - 1];

    // Save current state to past
    const currentSnapshot = {
      nodes: currentNodes.map(node => ({
        id: node.id,
        type: node.type,
        position: { ...node.position },
        data: { ...node.data },
        ...(node.width && { width: node.width }),
        ...(node.height && { height: node.height })
      })),
      edges: currentEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        ...(edge.animated !== undefined && { animated: edge.animated }),
        ...(edge.type && { type: edge.type })
      })),
      actionName: 'redo',
      timestamp: Date.now()
    };

    setFuture(prevFuture => prevFuture.slice(0, -1));
    setPast(prevPast => [...prevPast, currentSnapshot]);

    // Reset the flag after a short delay
    setTimeout(() => {
      isUndoingRef.current = false;
    }, 0);

    return nextState;
  }, [future]);

  /**
   * Clear all history (useful when loading a new flow)
   */
  const clearHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    pushSnapshot,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    clearHistory,
    historyLength: past.length,
    futureLength: future.length
  };
}

export default useFlowHistory;
