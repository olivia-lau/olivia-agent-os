# Olivia Agent OS interface system

The dashboard uses a compact, task-first workspace inspired by coding-agent interfaces.

## Shell

- **Sidebar:** primary navigation, new task, recent tasks, and connection state.
- **Task surface:** conversation-like run history with a persistent command composer.
- **Preview rail:** tabbed local-file preview that opens without leaving the task.
- **Responsive behavior:** the preview becomes an overlay on narrower screens; the sidebar collapses to icons on mobile widths.

## Tokens

- Neutral dark surfaces: `#111111`, `#181818`, `#202020`, and `#282828`.
- Primary text: `#f2f2f2`; secondary text: `#9b9b9b`.
- Success: `#71d49b`; attention: `#e6ad67`; danger: `#ed817a`; file links: `#8ab4f8`.
- Controls use 6–13 px radii, one-pixel neutral borders, and restrained shadows.

## Reusable patterns

- **Run:** command, route, status, task graph, result, files, context, and event history.
- **File link:** a verified local path exposed only from an approved workspace, vault, or run-artifact directory.
- **Preview tab:** image, PDF, or text/code preview with multiple open tabs.
- **Composer:** command text, dictation, routing controls, memory controls, and submit action.
- **Status:** ready, running, review, completed, failed, or deferred with consistent color semantics.
