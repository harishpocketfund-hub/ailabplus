"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

type MentionTextFieldProps = {
  value: string;
  onChange: (nextValue: string) => void;
  mentionOptions: string[];
  className?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  multiline?: boolean;
};

type MentionRange = {
  start: number;
  end: number;
  query: string;
};

function parseMentionRange(value: string, cursorPosition: number): MentionRange | null {
  if (cursorPosition < 0 || cursorPosition > value.length) {
    return null;
  }

  const mentionStart = value.lastIndexOf("@", cursorPosition - 1);
  if (mentionStart < 0) {
    return null;
  }

  const precedingChar = mentionStart > 0 ? value[mentionStart - 1] : " ";
  if (!/\s|[([{]/.test(precedingChar)) {
    return null;
  }

  const mentionToken = value.slice(mentionStart + 1, cursorPosition);
  if (/\s/.test(mentionToken)) {
    return null;
  }

  return {
    start: mentionStart,
    end: cursorPosition,
    query: mentionToken,
  };
}

function normalizeMentionOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  options.forEach((option) => {
    const trimmed = option.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized.sort((firstOption, secondOption) =>
    firstOption.localeCompare(secondOption)
  );
}

export default function MentionTextField({
  value,
  onChange,
  mentionOptions,
  className = "",
  placeholder,
  required = false,
  rows = 3,
  multiline = false,
}: MentionTextFieldProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const [mentionRange, setMentionRange] = useState<MentionRange | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const normalizedOptions = useMemo(
    () => normalizeMentionOptions(mentionOptions),
    [mentionOptions]
  );

  const suggestions = useMemo(() => {
    if (!mentionRange) {
      return [] as string[];
    }

    const normalizedQuery = mentionRange.query.trim().toLowerCase();
    if (!normalizedQuery) {
      return normalizedOptions.slice(0, 8);
    }

    return normalizedOptions
      .filter((option) => option.toLowerCase().includes(normalizedQuery))
      .slice(0, 8);
  }, [mentionRange, normalizedOptions]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const updateMentionState = (nextValue: string, cursorPosition: number) => {
    const nextRange = parseMentionRange(nextValue, cursorPosition);
    setMentionRange(nextRange);
    if (nextRange) {
      setActiveSuggestionIndex(0);
    }
  };

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const nextValue = event.target.value;
    onChange(nextValue);
    updateMentionState(nextValue, event.target.selectionStart ?? nextValue.length);
  };

  const syncFromCursor = (
    event:
      | ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
      | ReactMouseEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const cursorPosition = event.currentTarget.selectionStart ?? value.length;
    updateMentionState(value, cursorPosition);
  };

  const applyMention = (mentionValue: string) => {
    if (!mentionRange) {
      return;
    }

    const before = value.slice(0, mentionRange.start);
    const after = value.slice(mentionRange.end);
    const replacement = `@${mentionValue}`;
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const trailing = needsTrailingSpace ? " " : "";
    const nextValue = `${before}${replacement}${trailing}${after}`;
    const nextCursorPosition = before.length + replacement.length + trailing.length;

    onChange(nextValue);
    setMentionRange(null);

    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const element = inputRef.current;
        if (!element) {
          return;
        }
        element.focus();
        element.setSelectionRange(nextCursorPosition, nextCursorPosition);
      });
    }
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (!mentionRange || suggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((currentIndex) =>
        currentIndex + 1 >= suggestions.length ? 0 : currentIndex + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((currentIndex) =>
        currentIndex - 1 < 0 ? suggestions.length - 1 : currentIndex - 1
      );
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const selectedOption =
        suggestions[Math.min(activeSuggestionIndex, suggestions.length - 1)] ??
        suggestions[0];
      if (selectedOption) {
        applyMention(selectedOption);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionRange(null);
    }
  };

  const handleBlur = () => {
    if (typeof window === "undefined") {
      setMentionRange(null);
      return;
    }

    blurTimeoutRef.current = window.setTimeout(() => {
      setMentionRange(null);
    }, 100);
  };

  const showSuggestions = mentionRange !== null && suggestions.length > 0;
  const selectedSuggestionIndex =
    suggestions.length === 0
      ? 0
      : Math.min(activeSuggestionIndex, suggestions.length - 1);

  return (
    <div className="relative mt-1">
      {multiline ? (
        <textarea
          ref={(element) => {
            inputRef.current = element;
          }}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncFromCursor}
          onClick={syncFromCursor}
          onBlur={handleBlur}
          rows={rows}
          required={required}
          placeholder={placeholder}
          className={className}
        />
      ) : (
        <input
          ref={(element) => {
            inputRef.current = element;
          }}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncFromCursor}
          onClick={syncFromCursor}
          onBlur={handleBlur}
          required={required}
          placeholder={placeholder}
          className={className}
        />
      )}

      {showSuggestions ? (
        <div className="absolute z-40 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-black/15 bg-white p-1 shadow-lg">
          {suggestions.map((suggestion, index) => {
            const isActive = index === selectedSuggestionIndex;
            return (
              <button
                key={`${suggestion}-${index}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyMention(suggestion);
                }}
                className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                  isActive ? "bg-black text-white" : "text-black/80 hover:bg-black/5"
                }`}
              >
                @{suggestion}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
