export function controllerRequestEndpoints(access) {
  return {
    local: access.localDashboardEndpoint ?? access.dashboardEndpoint,
    origin: access.publicDashboardEndpoint ?? access.dashboardEndpoint,
  };
}
