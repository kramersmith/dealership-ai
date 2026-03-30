import { useState, useCallback, useRef, useEffect } from 'react'
import { CONFIRMATION_DISPLAY_MS } from '@/lib/constants'

interface UseEditableFieldReturn {
  isEditing: boolean
  editValue: string
  /** True briefly after a successful save (auto-dismisses after CONFIRMATION_DISPLAY_MS). */
  justSaved: boolean
  startEditing: () => void
  setEditValue: (value: string) => void
  commitEdit: () => void
  cancelEdit: () => void
}

/**
 * Hook for inline editing of a single field.
 * Tap → startEditing → shows input.
 * Type → setEditValue.
 * Blur/Enter → commitEdit → calls onSave → shows "just saved" briefly.
 * Escape → cancelEdit.
 */
export function useEditableField(
  displayValue: string,
  onSave: (newValue: string) => void
): UseEditableFieldReturn {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(displayValue)
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timer on unmount to avoid setting state on unmounted component
  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  const startEditing = useCallback(() => {
    setEditValue(displayValue)
    setIsEditing(true)
    setJustSaved(false)
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [displayValue])

  const commitEdit = useCallback(() => {
    setIsEditing(false)
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== displayValue) {
      onSave(trimmed)
      setJustSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setJustSaved(false), CONFIRMATION_DISPLAY_MS)
    }
  }, [editValue, displayValue, onSave])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue(displayValue)
  }, [displayValue])

  return { isEditing, editValue, justSaved, startEditing, setEditValue, commitEdit, cancelEdit }
}
