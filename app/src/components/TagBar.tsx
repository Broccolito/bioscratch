import React, { useMemo, useState } from "react";
import TagPicker from "./TagPicker";
import type { TagNode } from "../lib/tagIndex";

interface TagBarProps {
  /** The note's front-matter tags (canonical). */
  tags: string[];
  /** False when the front matter can't be rewritten safely (invalid YAML). */
  editable: boolean;
  /** Tags used in the current folder, depth-first, for the picker. */
  folderTags: TagNode[];
  folderName: string;
  onChange: (tags: string[]) => void;
  /** Filter the sidebar search by this tag. */
  onSelectTag: (tag: string) => void;
}

const TagIcon: React.FC = () => (
  <svg className="tag-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/>
    <circle cx="7.5" cy="7.5" r="1.5"/>
  </svg>
);

const TagBar: React.FC<TagBarProps> = ({ tags, editable, folderTags, folderName, onChange, onSelectTag }) => {
  const [adding, setAdding] = useState(false);
  const present = useMemo(() => new Set(tags), [tags]);

  return (
    <div className="tag-bar">
      <TagIcon />
      {/* The add control comes first so it stays put as tags are added. */}
      {!editable ? (
        <span
          className="tag-bar-note"
          title="These tags need to be edited in the YAML source to preserve this note's front matter safely."
        >
          Tags read-only (edit in YAML source)
        </span>
      ) : adding ? (
        <TagPicker
          options={folderTags}
          exclude={present}
          folderName={folderName}
          allowCreate
          placeholder="Add tag…"
          onPick={(tag) => {
            if (!present.has(tag)) onChange([...tags, tag]);
          }}
          onClose={() => setAdding(false)}
          onBackspaceEmpty={() => {
            if (tags.length > 0) onChange(tags.slice(0, -1));
          }}
        />
      ) : (
        <button className="tag-bar-add-btn" onClick={() => setAdding(true)} title="Add a tag (saved as front-matter tags)">
          + Add tags
        </button>
      )}
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          <button className="tag-chip-label" onClick={() => onSelectTag(tag)} title={`Search notes tagged #${tag}`}>
            #{tag}
          </button>
          {editable && (
            <button
              className="tag-chip-remove"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              aria-label={`Remove tag ${tag}`}
              title="Remove tag"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
};

export default TagBar;
