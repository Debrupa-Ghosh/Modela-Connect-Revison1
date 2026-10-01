import React, { useState, useEffect, useCallback } from "react";
import {
  FileCheck2,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  DollarSign,
  Calendar,
  AlertCircle,
  Send,
  Mail,
  UserCheck,
  UserX,
  Search,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useData } from "../../context/DataContext";
import { useAuth, isAuthorizedAdminEmail } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { StatusBadge } from "../ui/StatusBadge";
import { RequestItem, RequestType, AuthRequestUser } from "../../types";
import {
  subscribeToAllRequests,
  normalizeToAuthRequest,
} from "../../services/firebaseAuthService";

interface MailRequestUser {
  id?: string;
  uid: string;
  name: string;
  email: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "Pending" | "Approved" | "Rejected";
  role?: string | null;
  assignedRole?: string | null;
  requestDate?: string;
  requestedAt?: string;
  statusUpdatedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string | null;
  processedBy?: string | null;
  rejectionReason?: string | null;
  remarks?: string | null;
}

export const RequestsModule: React.FC = () => {
  const { requests, updateRequestStatus, createRequest } = useData();
  const { currentUser, currentRole, isSuperAdmin, isAdmin } = useAuth();
  const { success, error: toastError, info } = useToast();

  const isAdministrativePersonnel =
    isSuperAdmin ||
    isAdmin ||
    ["Super Admin", "Admin", "HR Admin", "SUPER_ADMIN", "SUPERADMIN", "HR_ADMIN"].includes(currentRole) ||
    isAuthorizedAdminEmail(currentUser?.email);

  // Top level active tab: "MAIL_REQUESTS" vs "WORKFLOW_REQUESTS"
  const [activeTab, setActiveTab] = useState<"MAIL_REQUESTS" | "WORKFLOW_REQUESTS">(
    isAdministrativePersonnel ? "MAIL_REQUESTS" : "WORKFLOW_REQUESTS"
  );

  // Incoming Mail Requests state
  const [mailRequests, setMailRequests] = useState<MailRequestUser[]>([]);
  const [isLoadingMail, setIsLoadingMail] = useState(false);
  const [mailSearchQuery, setMailSearchQuery] = useState("");
  const [mailStatusFilter, setMailStatusFilter] = useState<"ALL" | "PENDING" | "APPROVED" | "REJECTED">("ALL");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [processingUid, setProcessingUid] = useState<string | null>(null);
  const [roleSelections, setRoleSelections] = useState<Record<string, string>>({});

  // Workflow requests state
  const [filterType, setFilterType] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // New Workflow Request Form state
  const [reqType, setReqType] = useState<RequestType>("LEAVE");
  const [reqTitle, setReqTitle] = useState("");
  const [reqDescription, setReqDescription] = useState("");
  const [reqAmountOrDays, setReqAmountOrDays] = useState("3 Days");

  const canApproveWorkflow = ["Super Admin", "Admin", "HR Admin", "Manager"].includes(currentRole) || isAdministrativePersonnel;

  // Helper to normalize status
  const normStatus = (s?: string | null): "PENDING" | "APPROVED" | "REJECTED" => {
    if (!s) return "PENDING";
    const str = String(s).trim().toUpperCase();
    if (str === "APPROVED") return "APPROVED";
    if (str === "REJECTED") return "REJECTED";
    return "PENDING";
  };

  // Fetch Mail Requests from backend
  const fetchMailRequests = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingMail(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        const users = data.users || data.requests || [];
        if (Array.isArray(users)) {
          setMailRequests(users);
        }
      }
    } catch (err) {
      console.warn("Failed to load /api/users in RequestsModule:", err);
    } finally {
      if (!silent) setIsLoadingMail(false);
    }
  }, []);

  // Real-time synchronization for Incoming Mail Requests
  useEffect(() => {
    if (!isAdministrativePersonnel) return;

    fetchMailRequests(false);

    let eventSource: EventSource | null = null;
    let pollInterval: any = null;

    // Direct SSE Stream for instant 0ms push updates
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        eventSource = new EventSource("/api/users/stream");
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const userList = data.users || [];
            if (Array.isArray(userList) && userList.length > 0) {
              setMailRequests(userList);
            }
          } catch {}
        };
      } catch {}
    }

    // Subscribe to all requests listener
    const unsubscribeAll = subscribeToAllRequests(
      (loaded) => {
        if (Array.isArray(loaded) && loaded.length > 0) {
          setMailRequests((prev) => {
            const map = new Map<string, any>();
            prev.forEach((p) => {
              const k = (p.id || p.uid || p.email || "").toLowerCase();
              if (k) map.set(k, p);
            });
            loaded.forEach((inc) => {
              const k = (inc.id || inc.uid || inc.email || "").toLowerCase();
              if (k) map.set(k, { ...map.get(k), ...inc });
            });
            return Array.from(map.values());
          });
        }
      },
      () => {}
    );

    // Periodic backup poll every 2.5s
    pollInterval = setInterval(() => {
      fetchMailRequests(true);
    }, 2500);

    return () => {
      if (eventSource) eventSource.close();
      if (typeof unsubscribeAll === "function") unsubscribeAll();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isAdministrativePersonnel, fetchMailRequests]);

  // Handle Approve Mail Request
  const handleApproveMailRequest = async (user: MailRequestUser) => {
    const uid = user.id || user.uid;
    const assignedRole = roleSelections[uid] || user.role || "EMPLOYEE";
    setProcessingUid(uid);
    const nowIso = new Date().toISOString();
    const auditorEmail = currentUser?.email || "HR Admin";

    // Optimistic UI update
    setMailRequests((prev) =>
      prev.map((u) => {
        if (u.id === uid || u.uid === uid || u.email.toLowerCase() === user.email.toLowerCase()) {
          return {
            ...u,
            status: "APPROVED" as const,
            role: assignedRole,
            assignedRole,
            reviewedBy: auditorEmail,
            reviewedAt: nowIso,
            statusUpdatedAt: nowIso,
          };
        }
        return u;
      })
    );

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(uid)}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": auditorEmail,
        },
        body: JSON.stringify({
          role: assignedRole,
          remarks: `Approved by ${auditorEmail} via Requests Tab`,
        }),
      });

      if (res.ok) {
        success(
          "Request Approved",
          `Access granted for ${user.email} with role '${assignedRole}'.`
        );
      } else {
        toastError("Approval Failed", "Server could not process request.");
        fetchMailRequests(true);
      }
    } catch (err: any) {
      toastError("Approval Error", err.message || "Failed to reach server.");
      fetchMailRequests(true);
    } finally {
      setProcessingUid(null);
    }
  };

  // Handle Reject Mail Request
  const handleRejectMailRequest = async (user: MailRequestUser) => {
    const uid = user.id || user.uid;
    setProcessingUid(uid);
    const nowIso = new Date().toISOString();
    const auditorEmail = currentUser?.email || "HR Admin";

    // Optimistic UI update
    setMailRequests((prev) =>
      prev.map((u) => {
        if (u.id === uid || u.uid === uid || u.email.toLowerCase() === user.email.toLowerCase()) {
          return {
            ...u,
            status: "REJECTED" as const,
            reviewedBy: auditorEmail,
            reviewedAt: nowIso,
            statusUpdatedAt: nowIso,
            rejectionReason: "Access request declined by HR Admin",
          };
        }
        return u;
      })
    );

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(uid)}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-email": auditorEmail,
        },
        body: JSON.stringify({
          reason: "Access request declined by HR Admin",
        }),
      });

      if (res.ok) {
        info("Request Rejected", `Request from ${user.email} marked as rejected.`);
      } else {
        toastError("Rejection Failed", "Server could not process request.");
        fetchMailRequests(true);
      }
    } catch (err: any) {
      toastError("Rejection Error", err.message || "Failed to reach server.");
      fetchMailRequests(true);
    } finally {
      setProcessingUid(null);
    }
  };

  const handleCopyEmail = (email: string) => {
    navigator.clipboard?.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  // Filtered Mail Requests
  const filteredMailRequests = mailRequests
    .filter((req) => {
      const st = normStatus(req.status);
      const matchesStatus = mailStatusFilter === "ALL" || st === mailStatusFilter;
      const q = mailSearchQuery.toLowerCase().trim();
      const email = (req.email || "").toLowerCase();
      const name = (req.name || "").toLowerCase();
      const role = (req.role || "").toLowerCase();
      const matchesSearch = !q || email.includes(q) || name.includes(q) || role.includes(q);
      return matchesStatus && matchesSearch;
    })
    .sort((a, b) => {
      const stA = normStatus(a.status);
      const stB = normStatus(b.status);
      if (stA === "PENDING" && stB !== "PENDING") return -1;
      if (stB === "PENDING" && stA !== "PENDING") return 1;
      const timeA = new Date(a.requestDate || a.requestedAt || a.statusUpdatedAt || 0).getTime();
      const timeB = new Date(b.requestDate || b.requestedAt || b.statusUpdatedAt || 0).getTime();
      return timeB - timeA;
    });

  const pendingMailCount = mailRequests.filter((r) => normStatus(r.status) === "PENDING").length;
  const approvedMailCount = mailRequests.filter((r) => normStatus(r.status) === "APPROVED").length;
  const rejectedMailCount = mailRequests.filter((r) => normStatus(r.status) === "REJECTED").length;

  // Filtered Workflow Requests
  const filteredWorkflowRequests = requests.filter((r) => {
    const matchesType = filterType === "ALL" || r.type === filterType;
    const matchesStatus = filterStatus === "ALL" || r.status === filterStatus;
    return matchesType && matchesStatus;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqTitle.trim()) return;

    createRequest({
      employeeId: currentUser?.employeeId || "EMP104",
      employeeName: (currentUser?.name || "Marcus Vance").split(" (")[0],
      type: reqType,
      title: reqTitle,
      description: reqDescription,
      amountOrDays: reqAmountOrDays,
    });

    setIsCreateModalOpen(false);
    setReqTitle("");
    setReqDescription("");
    success("Request Submitted", "Your request has been routed to your direct reporting supervisor.");
  };

  const formatRelativeTime = (isoString?: string) => {
    if (!isoString) return "Recently";
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return "Just now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return "Recently";
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto antialiased">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
              Requests & Approvals Central
            </h1>
            {pendingMailCount > 0 && isAdministrativePersonnel && (
              <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 animate-pulse">
                {pendingMailCount} New Mail Request{pendingMailCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-stone-500 dark:text-slate-400 text-xs mt-1">
            Real-time management for incoming Google email access requests and internal employee workflow requisitions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          {isAdministrativePersonnel && activeTab === "MAIL_REQUESTS" && (
            <button
              onClick={() => fetchMailRequests(false)}
              disabled={isLoadingMail}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-stone-700 dark:text-slate-200 text-xs font-semibold rounded-xl border border-stone-200 dark:border-slate-600 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMail ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          )}

          <button
            id="new-request-btn"
            onClick={() => {
              setActiveTab("WORKFLOW_REQUESTS");
              setIsCreateModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#22C55E] to-[#16a34a] hover:from-[#16a34a] hover:to-[#15803d] text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Submit Staff Request</span>
          </button>
        </div>
      </div>

      {/* Main Tab Navigation (For Admin & Super Admin) */}
      {isAdministrativePersonnel && (
        <div className="flex items-center gap-2 p-1.5 bg-stone-100 dark:bg-slate-800/90 rounded-2xl border border-stone-200/80 dark:border-slate-700 w-fit">
          <button
            id="tab-mail-requests"
            onClick={() => setActiveTab("MAIL_REQUESTS")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "MAIL_REQUESTS"
                ? "bg-blue-600 text-white shadow-md"
                : "text-stone-600 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white"
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Incoming Mail Requests</span>
            {pendingMailCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-slate-900 font-extrabold">
                {pendingMailCount}
              </span>
            )}
          </button>

          <button
            id="tab-workflow-requests"
            onClick={() => setActiveTab("WORKFLOW_REQUESTS")}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === "WORKFLOW_REQUESTS"
                ? "bg-blue-600 text-white shadow-md"
                : "text-stone-600 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white"
            }`}
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>Staff Workflow Requests</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-stone-200 dark:bg-slate-700 text-stone-700 dark:text-slate-300 font-medium">
              {requests.length}
            </span>
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 1: INCOMING MAIL ACCESS REQUESTS                                    */}
      {/* ========================================================================= */}
      {isAdministrativePersonnel && activeTab === "MAIL_REQUESTS" && (
        <div className="space-y-4">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs">
              <span className="text-[11px] font-semibold text-stone-500 dark:text-slate-400 uppercase tracking-wider block">
                Total Mail Requests
              </span>
              <span className="text-2xl font-extrabold text-stone-900 dark:text-white mt-1 block">
                {mailRequests.length}
              </span>
            </div>

            <div
              onClick={() => setMailStatusFilter("PENDING")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                mailStatusFilter === "PENDING"
                  ? "bg-amber-500/10 border-amber-500/50 shadow-sm"
                  : "bg-white dark:bg-slate-800 border-stone-200/80 dark:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
                  Pending Review
                </span>
                {pendingMailCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                )}
              </div>
              <span className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 mt-1 block">
                {pendingMailCount}
              </span>
            </div>

            <div
              onClick={() => setMailStatusFilter("APPROVED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                mailStatusFilter === "APPROVED"
                  ? "bg-emerald-500/10 border-emerald-500/50 shadow-sm"
                  : "bg-white dark:bg-slate-800 border-stone-200/80 dark:border-slate-700"
              }`}
            >
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                Approved
              </span>
              <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1 block">
                {approvedMailCount}
              </span>
            </div>

            <div
              onClick={() => setMailStatusFilter("REJECTED")}
              className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                mailStatusFilter === "REJECTED"
                  ? "bg-rose-500/10 border-rose-500/50 shadow-sm"
                  : "bg-white dark:bg-slate-800 border-stone-200/80 dark:border-slate-700"
              }`}
            >
              <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-400 uppercase tracking-wider block">
                Rejected
              </span>
              <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 mt-1 block">
                {rejectedMailCount}
              </span>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-stone-400 dark:text-slate-400" />
              <input
                id="search-mail-requests"
                type="text"
                placeholder="Search by mail ID or user name..."
                value={mailSearchQuery}
                onChange={(e) => setMailSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-xs text-stone-900 dark:text-white placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-stone-500 dark:text-slate-400 font-semibold mr-1">Filter:</span>
              {(
                [
                  { label: "All", value: "ALL" },
                  { label: `Pending (${pendingMailCount})`, value: "PENDING" },
                  { label: "Approved", value: "APPROVED" },
                  { label: "Rejected", value: "REJECTED" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setMailStatusFilter(tab.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    mailStatusFilter === tab.value
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-stone-50 dark:bg-slate-900 text-stone-600 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white border border-stone-200 dark:border-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Incoming Mail Requests List */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 dark:bg-slate-900/90 border-b border-stone-200 dark:border-slate-700 text-[11px] font-bold text-stone-500 dark:text-slate-400 uppercase tracking-wider">
                    <th className="py-3.5 px-4">Incoming Mail ID</th>
                    <th className="py-3.5 px-4">Applicant Name</th>
                    <th className="py-3.5 px-4">Request Time</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Assign Role</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-slate-700/60 text-xs">
                  {filteredMailRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-stone-400 dark:text-slate-400 text-xs">
                        {isLoadingMail
                          ? "Checking for incoming requests..."
                          : "No requests found matching your filter."}
                      </td>
                    </tr>
                  ) : (
                    filteredMailRequests.map((req) => {
                      const st = normStatus(req.status);
                      const isPending = st === "PENDING";
                      const isApproved = st === "APPROVED";
                      const isRejected = st === "REJECTED";
                      const uid = req.id || req.uid;
                      const isProcessing = processingUid === uid;
                      const reqDate = req.requestDate || req.requestedAt || req.statusUpdatedAt;
                      const currentSelectedRole = roleSelections[uid] || req.role || "EMPLOYEE";

                      return (
                        <tr
                          key={uid}
                          id={`mail-request-row-${uid}`}
                          className={`hover:bg-stone-50/80 dark:hover:bg-slate-700/30 transition-colors ${
                            isPending ? "bg-amber-500/[0.04] dark:bg-amber-500/[0.06]" : ""
                          }`}
                        >
                          {/* 1. Mail ID (Highlighted with copy icon) */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
                                <Mail className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="font-mono font-bold text-stone-900 dark:text-white flex items-center gap-1.5">
                                  <span>{req.email}</span>
                                  <button
                                    onClick={() => handleCopyEmail(req.email)}
                                    className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                    title="Copy Mail ID"
                                  >
                                    {copiedEmail === req.email ? (
                                      <Check className="w-3 h-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                                <span className="text-[10px] text-stone-400 dark:text-slate-500 font-mono">
                                  UID: {uid.slice(0, 14)}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 2. Applicant Name */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-stone-800 dark:text-slate-100">
                              {req.name || req.email.split("@")[0]}
                            </div>
                            {req.role && (
                              <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                                Current Role: {req.role}
                              </span>
                            )}
                          </td>

                          {/* 3. Request Time */}
                          <td className="py-3.5 px-4 font-mono text-[11px] text-stone-600 dark:text-slate-300 whitespace-nowrap">
                            <div>{formatRelativeTime(reqDate)}</div>
                            <div className="text-[10px] text-stone-400 dark:text-slate-500">
                              {reqDate ? new Date(reqDate).toLocaleDateString() : ""}
                            </div>
                          </td>

                          {/* 4. Status Badge */}
                          <td className="py-3.5 px-4">
                            {isPending && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
                                <Clock className="w-3 h-3 text-amber-500" />
                                Pending Review
                              </span>
                            )}
                            {isApproved && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                Approved
                              </span>
                            )}
                            {isRejected && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
                                <XCircle className="w-3 h-3 text-rose-500" />
                                Rejected
                              </span>
                            )}
                          </td>

                          {/* 5. Role Assignment Selector */}
                          <td className="py-3.5 px-4">
                            <select
                              value={currentSelectedRole}
                              onChange={(e) =>
                                setRoleSelections((prev) => ({
                                  ...prev,
                                  [uid]: e.target.value,
                                }))
                              }
                              disabled={isProcessing}
                              className="px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-stone-800 dark:text-slate-100 font-medium focus:ring-2 focus:ring-blue-500/40"
                            >
                              <option value="EMPLOYEE">Employee</option>
                              <option value="HR_ADMIN">HR Admin</option>
                              <option value="HR_MANAGER">HR Manager</option>
                              {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                            </select>
                          </td>

                          {/* 6. Actions */}
                          <td className="py-3.5 px-4 text-right">
                            {isPending ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  id={`reject-mail-req-${uid}`}
                                  onClick={() => handleRejectMailRequest(req)}
                                  disabled={isProcessing}
                                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl border border-rose-200 dark:border-rose-800/60 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  <UserX className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>

                                <button
                                  id={`approve-mail-req-${uid}`}
                                  onClick={() => handleApproveMailRequest(req)}
                                  disabled={isProcessing}
                                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                  <UserCheck className="w-3.5 h-3.5" />
                                  <span>Approve & Unlock</span>
                                </button>
                              </div>
                            ) : isApproved ? (
                              <div className="text-right">
                                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold block">
                                  ✓ Access Granted
                                </span>
                                {req.reviewedBy && (
                                  <span className="text-[10px] text-stone-400 dark:text-slate-500 block">
                                    by {req.reviewedBy}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-[11px] text-rose-500 font-medium mr-1">
                                  Declined
                                </span>
                                <button
                                  onClick={() => handleApproveMailRequest(req)}
                                  disabled={isProcessing}
                                  className="px-2.5 py-1 bg-stone-100 dark:bg-slate-700 hover:bg-emerald-600 hover:text-white text-stone-700 dark:text-slate-300 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer"
                                >
                                  Re-Approve
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: STAFF WORKFLOW REQUESTS (PTO, EXPENSE, EQUIPMENT)               */}
      {/* ========================================================================= */}
      {(!isAdministrativePersonnel || activeTab === "WORKFLOW_REQUESTS") && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-stone-600 dark:text-slate-400 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-stone-400" />
              Filter Workflow:
            </span>

            <select
              id="requests-type-filter"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 text-xs bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-stone-800 dark:text-slate-200 focus:ring-2 focus:ring-[#22C55E]/40"
            >
              <option value="ALL">All Categories</option>
              <option value="LEAVE">Paid Time Off / Leave</option>
              <option value="EXPENSE">Expense Reimbursement</option>
              <option value="EQUIPMENT">Hardware & IT Access</option>
              <option value="GENERAL">General Inquiries</option>
            </select>

            <select
              id="requests-status-filter"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 text-xs bg-stone-50 dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-xl text-stone-800 dark:text-slate-200 focus:ring-2 focus:ring-[#22C55E]/40"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending Review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          {/* Requests Cards List */}
          {filteredWorkflowRequests.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/80 dark:border-slate-700 text-stone-500 dark:text-slate-400 text-xs">
              No staff workflow requests found. Click "Submit Staff Request" to create a new leave or expense item.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredWorkflowRequests.map((req) => (
                <div
                  key={req.id}
                  id={`request-card-${req.id}`}
                  className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-stone-200/80 dark:border-slate-700 shadow-2xs space-y-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-stone-600 dark:text-slate-300 px-1.5 py-0.5 bg-stone-100 dark:bg-slate-900 rounded">
                            {req.id}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {req.type}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-stone-900 dark:text-white mt-1.5">{req.title}</h3>
                      </div>
                      <StatusBadge label={req.status} size="sm" />
                    </div>

                    <p className="text-xs text-stone-600 dark:text-slate-300 mt-2 leading-relaxed">{req.description}</p>
                  </div>

                  <div className="pt-3 border-t border-stone-100 dark:border-slate-700 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-stone-500 dark:text-slate-400 text-[11px]">
                      <span>
                        Applicant: <strong className="text-stone-800 dark:text-slate-200">{req.employeeName}</strong> ({req.employeeId})
                      </span>
                      <span>
                        Scope: <strong className="text-stone-800 dark:text-slate-200">{req.amountOrDays}</strong>
                      </span>
                    </div>

                    {/* Action Buttons for Managers / HR */}
                    {req.status === "PENDING" && canApproveWorkflow && (
                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          id={`reject-req-${req.id}`}
                          onClick={() => {
                            updateRequestStatus(req.id, "REJECTED");
                            toastError("Request Rejected", `Request ${req.id} has been marked as rejected.`);
                          }}
                          className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                        <button
                          id={`approve-req-${req.id}`}
                          onClick={() => {
                            updateRequestStatus(req.id, "APPROVED");
                            success("Request Approved", `Request ${req.id} was approved.`);
                          }}
                          className="px-3.5 py-1.5 bg-gradient-to-r from-[#22C55E] to-[#16a34a] hover:from-[#16a34a] text-white text-xs font-semibold rounded-xl shadow-2xs transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Workflow Request Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700 shadow-2xl p-6 space-y-4">
            <h3 className="font-bold text-base text-stone-900 dark:text-white">Submit Administrative Request</h3>

            <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-stone-700 dark:text-slate-300 mb-1">Request Type</label>
                <select
                  value={reqType}
                  onChange={(e) => setReqType(e.target.value as RequestType)}
                  className="w-full px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-600 rounded-xl text-stone-800 dark:text-slate-100 focus:ring-2 focus:ring-[#22C55E]/40 focus:outline-none"
                >
                  <option value="LEAVE">Leave / Paid Time Off</option>
                  <option value="EXPENSE">Expense Reimbursement</option>
                  <option value="EQUIPMENT">Hardware / Equipment</option>
                  <option value="GENERAL">General Inquiries</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-stone-700 dark:text-slate-300 mb-1">Title / Subject *</label>
                <input
                  type="text"
                  value={reqTitle}
                  onChange={(e) => setReqTitle(e.target.value)}
                  placeholder="e.g. Annual Vacation or External Conference Pass"
                  className="w-full px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-600 rounded-xl text-stone-800 dark:text-slate-100 focus:ring-2 focus:ring-[#22C55E]/40 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 dark:text-slate-300 mb-1">Value or Duration</label>
                <input
                  type="text"
                  value={reqAmountOrDays}
                  onChange={(e) => setReqAmountOrDays(e.target.value)}
                  placeholder="e.g. 5 Business Days or $450 USD"
                  className="w-full px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-600 rounded-xl text-stone-800 dark:text-slate-100 focus:ring-2 focus:ring-[#22C55E]/40 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-stone-700 dark:text-slate-300 mb-1">Detailed Explanation</label>
                <textarea
                  rows={3}
                  value={reqDescription}
                  onChange={(e) => setReqDescription(e.target.value)}
                  placeholder="Provide context for managerial evaluation..."
                  className="w-full px-3 py-2 bg-stone-50 dark:bg-slate-900 border border-stone-300 dark:border-slate-600 rounded-xl text-stone-800 dark:text-slate-100 focus:ring-2 focus:ring-[#22C55E]/40 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-stone-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-stone-100 hover:bg-stone-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-stone-700 dark:text-slate-200 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Submit Request</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
