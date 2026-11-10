// INERT leftover — NOT a script.
// It came from a PowerShell ">" redirect (git show ... > file), which writes UTF-16.
// Kept only to document the path; the working replacement is:
//   node docs/audit/.tmp-f02/run-suite.mjs head:<suite>
// (that runner extracts git HEAD copies as UTF-8 via node).
export const NOTE = 'inert leftover';
