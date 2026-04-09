# Mermaid Diagrams

Click any diagram to reveal and edit the source. Changes re-render live.

## Flowchart

```mermaid
flowchart TD
    A[Open Bioscratch] --> B{File exists?}
    B -->|Yes| C[Load from disk]
    B -->|No| D[Start blank document]
    C --> E{Autosave found?}
    E -->|Yes| F[Offer recovery]
    E -->|No| G[Show document]
    F --> G
    D --> G
```

## Sequence Diagram

```mermaid
sequenceDiagram
    participant U as User
    participant E as Editor
    participant R as Rust Backend

    U->>E: Type Markdown
    E->>E: Parse & render
    E-->>U: Show preview

    U->>E: Cmd+S
    E->>R: write_file(path, content)
    R-->>E: Ok
    E-->>U: "Saved" indicator
```

## Class Diagram

```mermaid
classDiagram
    class EditorView {
        +state: EditorState
        +dispatch(tr)
        +updateState(state)
    }
    class Plugin {
        +key: PluginKey
        +props: PluginProps
        +spec: PluginSpec
    }
    class NodeView {
        +dom: HTMLElement
        +contentDOM: HTMLElement
        +update(node) bool
        +ignoreMutation() bool
        +destroy()
    }
    EditorView --> Plugin : uses
    EditorView --> NodeView : renders
```

## Git Graph

```mermaid
gitGraph
    commit id: "init"
    commit id: "schema"
    branch feature/math
    checkout feature/math
    commit id: "katex"
    commit id: "math-nodeview"
    checkout main
    merge feature/math id: "merge math"
    branch feature/images
    checkout feature/images
    commit id: "image-plugin"
    checkout main
    merge feature/images id: "merge images"
    commit id: "mermaid"
```

## Pie Chart

```mermaid
pie title Time spent per feature
    "Editor core" : 35
    "Markdown parsing" : 20
    "Math rendering" : 15
    "Image handling" : 18
    "Export" : 12
```

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Inactive
    Inactive --> Active : cursor enters block
    Active --> Inactive : cursor leaves block
    Active --> Active : keystroke (live preview)
    Active --> [*] : block deleted
```

## Color Test — Explicit Node Colors

```mermaid
flowchart LR
    A[Idea]:::violet --> B[Design]:::blue
    B --> C[Build]:::orange
    C --> D{Works?}:::yellow
    D -->|Yes| E[Ship]:::green
    D -->|No| F[Debug]:::red
    F --> C

    classDef violet  fill:#8e44ad,stroke:#6c3483,color:#fff
    classDef blue    fill:#2980b9,stroke:#1a5276,color:#fff
    classDef orange  fill:#e67e22,stroke:#ca6f1e,color:#fff
    classDef yellow  fill:#f1c40f,stroke:#d4ac0d,color:#1a1a1a
    classDef green   fill:#27ae60,stroke:#1e8449,color:#fff
    classDef red     fill:#e74c3c,stroke:#cb4335,color:#fff
```
