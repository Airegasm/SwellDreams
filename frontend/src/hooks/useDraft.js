import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom hook for session-based draft persistence.
 * Saves form state to sessionStorage so accidental modal dismissals don't lose work.
 *
 * @param {string} draftKey - Unique key for this draft (e.g., 'character-edit-123')
 * @param {any} initialData - Initial form data (from existing entity or defaults)
 * @param {boolean} isOpen - Whether the modal/form is currently open
 * @returns {object} - { formData, setFormData, clearDraft, hasDraft, discardDraft }
 */
export function useDraft(draftKey, initialData, isOpen) {
  const [formData, setFormData] = useState(initialData);
  const [hasDraft, setHasDraft] = useState(false);
  const initializedRef = useRef(false);
  const keyRef = useRef(draftKey);
  const prevKeyRef = useRef(draftKey);

  // Load draft from sessionStorage when modal opens OR when key changes (switching entities)
  useEffect(() => {
    const keyChanged = prevKeyRef.current !== draftKey;
    prevKeyRef.current = draftKey;
    keyRef.current = draftKey;

    if (isOpen && draftKey) {
      // If key changed while modal is open, reset initialized flag to force reload
      if (keyChanged) {
        initializedRef.current = false;
      }

      // Skip if already initialized - don't reset formData when initialData changes
      // This prevents losing user changes when background data updates
      if (initializedRef.current) {
        return;
      }

      const storageKey = `swelldreams-draft-${draftKey}`;
      const savedDraft = sessionStorage.getItem(storageKey);

      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);

          // Validate draft: if server data has more content than draft, draft is stale
          // This catches drafts created before character fully loaded
          const draftStories = parsed.stories || [];
          const initStories = initialData.stories || [];
          const draftHasLessData = initStories.some((initStory, idx) => {
            const draftStory = draftStories[idx];
            if (!draftStory) return true;
            // Check if server has flows/buttons/dialogues but draft doesn't
            const serverFlows = initStory.assignedFlows?.length || 0;
            const draftFlows = draftStory.assignedFlows?.length || 0;
            const serverButtons = initStory.assignedButtons?.length || 0;
            const draftButtons = draftStory.assignedButtons?.length || 0;
            const serverDialogues = initStory.exampleDialogues?.length || 0;
            const draftDialogues = draftStory.exampleDialogues?.length || 0;
            return serverFlows > draftFlows || serverButtons > draftButtons || serverDialogues > draftDialogues;
          });

          if (draftHasLessData) {
            sessionStorage.removeItem(storageKey);
            setFormData(initialData);
            setHasDraft(false);
          } else {
            setFormData(parsed);
            setHasDraft(true);
          }
          initializedRef.current = true;
        } catch (e) {
          console.error('Failed to parse draft:', e);
          setFormData(initialData);
          setHasDraft(false);
          initializedRef.current = true;
        }
      } else {
        // No draft - use initialData from the new entity
        setFormData(initialData);
        setHasDraft(false);
        initializedRef.current = true;
      }
    } else if (!isOpen) {
      initializedRef.current = false;
    }
  }, [isOpen, draftKey, initialData]);

  // Save to sessionStorage whenever formData changes (debounced)
  useEffect(() => {
    if (!isOpen || !keyRef.current || !initializedRef.current) return;

    const storageKey = `swelldreams-draft-${keyRef.current}`;
    const timeoutId = setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(formData));
      } catch (e) {
        console.error('Failed to save draft:', e);
      }
    }, 300); // Debounce 300ms

    return () => clearTimeout(timeoutId);
  }, [formData, isOpen]);

  // Clear draft (call on successful save)
  const clearDraft = useCallback(() => {
    if (keyRef.current) {
      const storageKey = `swelldreams-draft-${keyRef.current}`;
      sessionStorage.removeItem(storageKey);
      setHasDraft(false);
    }
  }, []);

  // Discard draft and reset to initial data
  const discardDraft = useCallback(() => {
    clearDraft();
    setFormData(initialData);
  }, [clearDraft, initialData]);

  return {
    formData,
    setFormData,
    clearDraft,
    hasDraft,
    discardDraft
  };
}

/**
 * Helper to generate draft keys
 */
export function getDraftKey(type, id) {
  return id ? `${type}-${id}` : `${type}-new`;
}

export default useDraft;
