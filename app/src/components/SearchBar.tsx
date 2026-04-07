import React, { useEffect, useRef } from "react";
import { EditorView } from "prosemirror-view";
import {
  setSearch,
  navigateSearch,
  searchPluginKey,
} from "../editor/plugins/search";

interface SearchBarProps {
  view: EditorView | null;
  onClose: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ view, onClose }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const getSearchState = () => {
    if (!view) return null;
    return searchPluginKey.getState(view.state);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!view) return;
    setSearch(e.target.value, view.state, view.dispatch);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!view) return;
      navigateSearch(e.shiftKey ? -1 : 1, view.state, view.dispatch);
    }
  };

  const handleClose = () => {
    if (view) {
      setSearch("", view.state, view.dispatch);
    }
    onClose();
  };

  const searchState = getSearchState();
  const matchCount = searchState?.matches.length || 0;
  const currentIndex = searchState?.currentIndex || 0;
  const query = searchState?.query || "";

  const matchText =
    matchCount === 0
      ? query
        ? "No matches"
        : ""
      : `${currentIndex + 1} / ${matchCount}`;

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        type="text"
        placeholder="Search..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <span className="match-count">{matchText}</span>
      <button
        className="search-btn"
        onClick={() => {
          if (!view) return;
          navigateSearch(-1, view.state, view.dispatch);
        }}
        title="Previous match (Shift+Enter)"
      >
        ↑
      </button>
      <button
        className="search-btn"
        onClick={() => {
          if (!view) return;
          navigateSearch(1, view.state, view.dispatch);
        }}
        title="Next match (Enter)"
      >
        ↓
      </button>
      <button className="close-btn" onClick={handleClose} title="Close (Esc)">
        ×
      </button>
    </div>
  );
};

export default SearchBar;
