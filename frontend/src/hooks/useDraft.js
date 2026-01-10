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

  // Update key ref when it changes
  useEffect(() => {
    keyRef.current = draftKey;
  }, [draftKey]);

  // Load draft from sessionStorage when modal opens
  useEffect(() => {
    if (isOpen && draftKey) {
      const storageKey = `swelldreams-draft-${draftKey}`;
      const savedDraft = sessionStorage.getItem(storageKey);

      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);
          setFormData(parsed);
          setHasDraft(true);
          initializedRef.current = true;
        } catch (e) {
          console.error('Failed to parse draft:', e);
          setFormData(initialData);
          setHasDraft(false);
          initializedRef.current = true;
        }
      } else {
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
