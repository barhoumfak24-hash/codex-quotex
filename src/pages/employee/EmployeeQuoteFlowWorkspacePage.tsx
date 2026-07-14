import { Navigate, useParams } from "react-router-dom";

export function EmployeeQuoteFlowWorkspacePage() {
  const { customerId, prospectId } = useParams();

  if (customerId) {
    return <Navigate to={`/employee/clients/${customerId}?quoteWorkspace=expanded`} replace />;
  }

  if (prospectId) {
    return <Navigate to={`/employee/prospects/${prospectId}?quoteWorkspace=expanded`} replace />;
  }

  return <Navigate to="/employee/clients" replace />;
}
