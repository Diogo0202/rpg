export function getClarityConfig() {
  const enabled = process.env.NEXT_PUBLIC_CLARITY_ENABLED === "true";
  const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID?.trim() ?? "";
  const validProjectId = /^[a-zA-Z0-9]{8,32}$/.test(projectId);

  return {
    enabled: enabled && validProjectId,
    projectId: validProjectId ? projectId : null,
  };
}
