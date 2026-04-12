import React, { useEffect, useRef, useState } from "react";
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
  // Drive the input off React state so it accumulates keystrokes correctly.
  // Plugin state only controls decorations; reading it back for the controlled
  // value doesn't work because search transactions don't change the doc, so
  // dispatchTransaction never fires onChangeRef → React never re-renders →
  // the controlled input resets to "" after every keystroke.
  const [query, setQuery] = useState("");
  // Bump this to force a re-render after navigation so the match counter updates.
  const [, setNavTick] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    if (view) setSearch(newQuery, view.state, view.dispatch);
  };

  const handleNavigate = (dir: 1 | -1) => {
    if (!view) return;
    navigateSearch(dir, view.state, view.dispatch);
    setNavTick((t) => t + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleNavigate(e.shiftKey ? -1 : 1);
    }
  };

  const handleClose = () => {
    if (view) setSearch("", view.state, view.dispatch);
    onClose();
  };

  const searchState = view ? searchPluginKey.getState(view.state) : null;
  const matchCount = searchState?.matches.length ?? 0;
  const currentIndex = searchState?.currentIndex ?? 0;

  const matchText =
    matchCount === 0
      ? query ? "No matches" : ""
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
        onClick={() => handleNavigate(-1)}
        title="Previous match (Shift+Enter)"
      >
        ↑
      </button>
      <button
        className="search-btn"
        onClick={() => handleNavigate(1)}
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
