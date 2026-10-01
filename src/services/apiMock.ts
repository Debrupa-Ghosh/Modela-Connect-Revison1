/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  loadStoredUsers,
  loadStoredAuditLogs,
  loadStoredEmployees,
  saveStoredEmployees,
  clientLoginWithGoogle,
  clientApproveUser,
  clientRejectUser,
  clientUpdateUserRole,
  clientMarkNotificationRead,
  appendClientAuditLog,
  normalizeUserStatus,
} from "./clientStorage";

/**
 * Initializes transparent client-side mock for `/api/*` endpoints
 */
export function initClientApiMock(): void {
  if (typeof window === "undefined") return;

  const originalFetch = window.fetch ? window.fetch.bind(window) : undefined;

  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlString = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    // First attempt to reach the actual backend server API
    if (originalFetch) {
      try {
        const liveResponse = await originalFetch(input, init);
        const contentType = liveResponse?.headers?.get("content-type") || "";
        // Only return live response if it returned valid JSON (not an HTML fallback from static host)
        if (
          liveResponse &&
          (liveResponse.ok || liveResponse.status < 500) &&
          (contentType.toLowerCase().includes("application/json") ||
            contentType.toLowerCase().includes("+json"))
        ) {
          return liveResponse;
        }
      } catch {
        // Fall back to client storage mock if live server is unreachable
      }
    }

    // Only intercept routes starting with /api/
    if (!urlString.startsWith("/api/") && !urlString.includes("/api/")) {
      if (originalFetch) {
        return originalFetch(input, init);
      }
      return new Response("Not found", { status: 404 });
    }

    try {
      const url = new URL(urlString, window.location.origin);
      const pathname = url.pathname;
      const method = (init?.method || "GET").toUpperCase();
      let body: any = {};
      if (init?.body && typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = {};
        }
      }

      // 1. Health check
      if (pathname === "/api/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
            mode: "client-side-spa",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 2. Google OAuth / Login
      if (pathname === "/api/auth/google" || pathname === "/api/auth/login") {
        const email = body.email || "";
        const name = body.name || "";
        const avatarUrl = body.avatar_url || "";
        const result = clientLoginWithGoogle(email, name, avatarUrl);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 3. User status query
      if (pathname === "/api/auth/status") {
        const email = (url.searchParams.get("email") || "").toLowerCase().trim();
        const users = loadStoredUsers();
        const matched = users.find((u) => u.email.toLowerCase() === email);

        if (!matched) {
          return new Response(
            JSON.stringify({ success: true, status: "NotFound", user: null }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        const normStatus = normalizeUserStatus(matched.status);
        const token =
          normStatus === "APPROVED"
            ? "modela_session_" + Date.now() + "_" + Math.random().toString(36).substring(2)
            : undefined;

        return new Response(
          JSON.stringify({
            success: true,
            status: normStatus,
            token,
            user: matched,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // 4. Logout
      if (pathname === "/api/auth/logout") {
        if (body.email) {
          appendClientAuditLog({
            action: "Logout",
            targetUser: body.email,
            executedBy: body.email,
            details: "User initiated sign out session termination.",
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 5. Users List / Access Requests
      if ((pathname === "/api/users" || pathname === "/api/access_requests" || pathname === "/api/access-requests") && method === "GET") {
        const users = loadStoredUsers();
        return new Response(JSON.stringify({ success: true, users, requests: users }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 5b. Users Pending List (status === 'PENDING')
      if ((pathname === "/api/users/pending" || pathname === "/api/access_requests/pending" || pathname === "/api/access-requests/pending") && method === "GET") {
        const users = loadStoredUsers();
        const pending = users.filter((u) => normalizeUserStatus(u.status) === "PENDING");
        return new Response(JSON.stringify({ success: true, users: pending, pendingRequests: pending, requests: pending }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 6. User Approve: /api/users/:uid/approve
      const approveMatch = pathname.match(/^\/api\/(?:users|access_requests|access-requests)\/([^/]+)\/approve$/);
      if (approveMatch && method === "POST") {
        const targetUid = decodeURIComponent(approveMatch[1]);
        const role = body.role || "EMPLOYEE";
        const auditorEmail =
          (init?.headers as any)?.["x-user-email"] ||
          localStorage.getItem("modela_active_user_data")
            ? JSON.parse(localStorage.getItem("modela_active_user_data") || "{}").email || "Admin"
            : "Admin";

        const res = clientApproveUser(targetUid, role, auditorEmail);
        return new Response(JSON.stringify(res), {
          status: res.success ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 7. User Reject: /api/users/:uid/reject
      const rejectMatch = pathname.match(/^\/api\/(?:users|access_requests|access-requests)\/([^/]+)\/reject$/);
      if (rejectMatch && method === "POST") {
        const targetUid = decodeURIComponent(rejectMatch[1]);
        const auditorEmail =
          (init?.headers as any)?.["x-user-email"] ||
          localStorage.getItem("modela_active_user_data")
            ? JSON.parse(localStorage.getItem("modela_active_user_data") || "{}").email || "Admin"
            : "Admin";

        const res = clientRejectUser(targetUid, auditorEmail);
        return new Response(JSON.stringify(res), {
          status: res.success ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 8. User Role Change: /api/users/:uid/role
      const roleMatch = pathname.match(/^\/api\/users\/([^/]+)\/role$/);
      if (roleMatch && method === "POST") {
        const targetUid = decodeURIComponent(roleMatch[1]);
        const role = body.role;
        const auditorEmail =
          (init?.headers as any)?.["x-user-email"] || "Admin";

        const res = clientUpdateUserRole(targetUid, role, auditorEmail);
        return new Response(JSON.stringify(res), {
          status: res.success ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 9. Mark Notification Read: /api/users/:uid/mark-notification-read
      const markNotifMatch = pathname.match(/^\/api\/users\/([^/]+)\/mark-notification-read$/);
      if (markNotifMatch && method === "POST") {
        const targetUid = decodeURIComponent(markNotifMatch[1]);
        const ok = clientMarkNotificationRead(targetUid);
        return new Response(JSON.stringify({ success: ok }), {
          status: ok ? 200 : 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 10. Audit Logs
      if (pathname === "/api/audit-logs" && method === "GET") {
        const logs = loadStoredAuditLogs();
        return new Response(JSON.stringify({ success: true, logs }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 11. Employees Directory
      if (pathname === "/api/employees") {
        if (method === "GET") {
          const emps = loadStoredEmployees();
          return new Response(JSON.stringify({ success: true, employees: emps }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (method === "POST") {
          const emps = loadStoredEmployees();
          const newId = body.id || "MOD" + String(emps.length + 1).padStart(3, "0");
          const created = {
            ...body,
            id: newId,
            status: body.status || "ACTIVE",
            compensation: body.compensation || { basic: 30000, allowances: 10000 },
          };
          emps.unshift(created);
          saveStoredEmployees(emps);
          appendClientAuditLog({
            action: "Employee Created",
            targetUser: `${created.firstName} ${created.lastName}`,
            executedBy: "Admin",
            details: `New employee created: ${created.id} - ${created.designation}`,
          });
          return new Response(JSON.stringify({ success: true, employee: created }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Employee Single Update/Delete: /api/employees/:id
      const empItemMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
      if (empItemMatch) {
        const empId = decodeURIComponent(empItemMatch[1]);
        const emps = loadStoredEmployees();
        const idx = emps.findIndex((e) => e.id === empId);

        if (method === "PUT") {
          if (idx === -1) {
            return new Response(JSON.stringify({ error: "Employee not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }
          emps[idx] = { ...emps[idx], ...body, id: empId };
          saveStoredEmployees(emps);
          appendClientAuditLog({
            action: "Employee Updated",
            targetUser: `${emps[idx].firstName} ${emps[idx].lastName}`,
            executedBy: "Admin",
            details: `Employee profile updated for ${empId}`,
          });
          return new Response(JSON.stringify({ success: true, employee: emps[idx] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (method === "DELETE") {
          if (idx === -1) {
            return new Response(JSON.stringify({ error: "Employee not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }
          const [removed] = emps.splice(idx, 1);
          saveStoredEmployees(emps);
          appendClientAuditLog({
            action: "Employee Deleted",
            targetUser: `${removed.firstName} ${removed.lastName}`,
            executedBy: "Admin",
            details: `Employee ${empId} deleted from directory`,
          });
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Fallback 404 for unknown /api/ route
      return new Response(JSON.stringify({ error: "Not Found", path: pathname }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      console.error("Client API Mock Error:", err);
      return new Response(JSON.stringify({ error: "Internal Mock Error", details: err?.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };

  // Safely define fetch without throwing 'Cannot set property fetch which has only a getter'
  try {
    Object.defineProperty(window, "fetch", {
      value: customFetch,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  } catch (errWindow) {
    try {
      const proto = Object.getPrototypeOf(window);
      if (proto) {
        Object.defineProperty(proto, "fetch", {
          value: customFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    } catch (errProto) {
      try {
        if (typeof globalThis !== "undefined") {
          Object.defineProperty(globalThis, "fetch", {
            value: customFetch,
            writable: true,
            configurable: true,
            enumerable: true,
          });
        }
      } catch (errGlobal) {
        console.warn("Could not patch window.fetch:", errGlobal);
      }
    }
  }
}
