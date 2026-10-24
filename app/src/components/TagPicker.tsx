import React, { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTag } from "../lib/tags";
import type { TagNode } from "../lib/tagIndex";

interface TagPickerProps {
  /** Tags to offer, depth-first (parents before their subtags). */
  options: TagNode[];
  /** Tags not to offer (already applied). */
  exclude: Set<string>;
  /** Shown in the menu header: "Tags in <folderName>". */
  folderName: string;
  /** Offer "Create #…" for a typed tag nobody uses yet. */
  allowCreate: boolean;
  placeholder: string;
  onPick: (tag: string) => void;
  onClose: () => void;
  /** Backspace in the empty input. */
  onBackspaceEmpty?: () => void;
}

const MAX_OPTIONS = 12;

/** A tag input with a menu of existing tags (and subtags) to choose from. */
const TagPicker: React.FC<TagPickerProps> = ({
  options,
  exclude,
  folderName,
  allowCreate,
  placeholder,
  onPick,
  onClose,
  onBackspaceEmpty,
}) => {
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setHighlight(0); }, [draft]);

  const query = draft.trim().replace(/^#/, "").toLowerCase();
  const created = normalizeTag(draft);
  const known = useMemo(() => new Set(options.map((o) => o.tag)), [options]);

  const matches = useMemo(() => {
    const available = options.filter((o) => !exclude.has(o.tag));
    if (!query) return available.slice(0, MAX_OPTIONS);
    // "lab/" lists lab's subtags; otherwise match anywhere, prefix first.
    const parent = query.endsWith("/") ? query.slice(0, -1) : null;
    const hits = parent
      ? available.filter((o) => o.tag.startsWith(`${parent}/`))
      : [
          ...available.filter((o) => o.tag.startsWith(query) || o.name.startsWith(query)),
          ...available.filter((o) => !o.tag.startsWith(query) && !o.name.startsWith(query) && o.tag.includes(query)),
        ];
    return hits.slice(0, MAX_OPTIONS);
  }, [options, exclude, query]);

  const canCreate = allowCreate && !!created && !known.has(created) && !exclude.has(created);
  const rows: Array<{ tag: string; node: TagNode | null }> = [
    ...matches.map((node) => ({ tag: node.tag, node })),
    ...(canCreate ? [{ tag: created!, node: null }] : []),
  ];

  const pick = (tag: string | undefined) => {
    if (!tag) return;
    onPick(tag);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      pick(rows[highlight]?.tag ?? (canCreate ? created! : undefined));
    } else if (e.key === "Tab" && rows[highlight]?.node) {
      // Tab completes a parent so its subtags can be typed: "lab" → "lab/".
      e.preventDefault();
      setDraft(`${rows[highlight].tag}/`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(rows.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Backspace" && !draft) {
      onBackspaceEmpty?.();
    }
  };

  const empty = options.length === 0;

  return (
    <div className="tag-picker">
      <input
        ref={inputRef}
        className="tag-picker-input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        // Let a menu click land before closing.
        onBlur={() => setTimeout(onClose, 120)}
        spellCheck={false}
        aria-label={placeholder}
      />
      <div className="tag-picker-menu" role="listbox">
        <div className="tag-picker-header">
          {empty ? `No tags in ${folderName} yet` : `Tags in ${folderName}`}
        </div>
        {rows.map(({ tag, node }, i) => (
          <div
            key={`${node ? "known" : "new"}:${tag}`}
            role="option"
            aria-selected={i === highlight}
            className={`tag-picker-option${i === highlight ? " highlighted" : ""}`}
            style={node ? { paddingLeft: 8 + (tag.split("/").length - 1) * 12 } : undefined}
            onMouseMove={() => setHighlight(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(tag);
            }}
            title={`#${tag}`}
          >
            {node ? (
              <>
                <span className="tag-picker-name">
                  {node.tag.includes("/") && <span className="tag-picker-parent">{node.tag.slice(0, node.tag.lastIndexOf("/") + 1)}</span>}
                  {node.name}
                </span>
                <span className="properties-count">{node.count}</span>
              </>
            ) : (
              <span>Create <strong>#{tag}</strong></span>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="tag-picker-hint">
            {empty
              ? allowCreate ? "Type a name to create the first one." : "Tag notes with the tag bar above the editor."
              : "No matching tags."}
          </div>
        )}
        {allowCreate && (
          <div className="tag-picker-hint">Use / for subtags, e.g. <code>lab/assays</code>. Tab completes a parent.</div>
        )}
      </div>
    </div>
  );
};

export default TagPicker;
