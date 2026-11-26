import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const txRows = Array.from({ length: 1250 }, (_, i) => ({
    id: `tx-${i}`,
    doc_number: `OUT-2026-${String(i + 1).padStart(6, "0")}`,
    type: "out",
    status: "posted",
    transaction_date: "2026-11-26",
    source_location_id: null,
    dest_location_id: null,
    reference: null,
    notes: null,
    surat_jalan_url: null,
    idempotency_key: `k-${i}`,
    created_by: null,
    posted_at: "2026-11-26T00:00:00Z",
    reversed_at: null,
    reversal_of: null,
    reversal_reason: null,
    created_at: `2026-11-26T00:00:${String(i % 60).padStart(2, "0")}Z`,
    updated_at: "2026-11-26T00:00:00Z",
  }));

  const reqRows = Array.from({ length: 650 }, (_, i) => ({
    id: `req-${i}`,
    request_number: `REQ-2026-${String(i + 1).padStart(6, "0")}`,
    ticket_no: `TKT-${i + 1}`,
    branch_code: "JKT",
    branch_name: "Gerai Jakarta",
    request_date: "2026-11-26",
    request_type: "penambahan",
    status: "selesai",
    notes: null,
    requested_by: null,
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    loan_duration_days: null,
    created_at: `2026-11-26T00:00:${String(i % 60).padStart(2, "0")}Z`,
    updated_at: "2026-11-26T00:00:00Z",
  }));

  return { txRows, reqRows };
});

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "admin@example.com" },
    profile: null,
    permissions: [],
    loading: false,
    isSuperAdmin: true,
    isStaff: true,
    hasPermission: () => true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makePagedQuery(rows: Record<string, unknown>[]) {
  let rangeStart = 0;
  let rangeEnd = 999; // Simulasi batas keras 1.000 baris PostgREST per request
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "not", "in", "or", "gte", "lte", "order", "limit"]) {
    builder[m] = () => builder;
  }
  builder.range = (from: number, to: number) => {
    rangeStart = from;
    rangeEnd = Math.min(to, from + 999);
    return builder;
  };
  // oxlint-disable-next-line unicorn/no-thenable
  builder.then = (resolve: (v: unknown) => void) =>
    resolve({ data: rows.slice(rangeStart, rangeEnd + 1), error: null });
  return builder;
}

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "inventory_transactions") return makePagedQuery(mocks.txRows);
      if (table === "requests") return makePagedQuery(mocks.reqRows);
      return makePagedQuery([]);
    },
  },
}));

const { TransactionHistoryPage } = await import("./TransactionHistoryPage");
const { RequestListPage } = await import("./RequestListPage");

describe("Ketahanan jangka panjang di atas batas 500/1.000 baris", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TransactionHistoryPage memuat seluruh 1.250 transaksi melewati batas 1.000 baris PostgREST", async () => {
    render(
      <MemoryRouter>
        <TransactionHistoryPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/(1\.250|1250).*baris/i)).toBeInTheDocument();
    });
  });

  it("RequestListPage memuat seluruh 650 permintaan melewati batas lama 500 baris", async () => {
    render(
      <MemoryRouter>
        <RequestListPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/650.*baris/i)).toBeInTheDocument();
    });
  });
});
