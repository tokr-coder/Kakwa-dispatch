// Snow workflows are siblings. A later delivery workflow (phase 2, Lightspeed)
// would be another entry with phase: 'delivery' and its own planner.
// It must not be folded into pushing.
export const workflows = [
  { id: 'pushing', phase: 'snow', label: 'Pushing', planner: 'site-window' },
  { id: 'sanding', phase: 'snow', label: 'Sanding', planner: 'site-window' },
  { id: 'hauling', phase: 'snow', label: 'Hauling', planner: 'move' },
]

export function workflowById(id) {
  return workflows.find((item) => item.id === id) ?? null
}
