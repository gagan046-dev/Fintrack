import { apiError } from "@/lib/api-response";
import { requireHouseholdContext } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { TAX_SECTIONS, financialYearFromDate, financialYearRange } from "@/lib/tax";

export async function GET(request: Request) {
  try {
    const { householdId } = await requireHouseholdContext();
    const url = new URL(request.url);
    const requestedYear = Number(url.searchParams.get("year"));
    const currentFy = financialYearFromDate(new Date());
    const year = Number.isInteger(requestedYear) && requestedYear >= 2015 && requestedYear <= currentFy + 1 ? requestedYear : currentFy;
    const range = financialYearRange(year);

    const grouped = await getDb().transaction.groupBy({
      by: ["taxSection"],
      where: { householdId, deletedAt: null, taxSection: { not: null }, transactionAt: { gte: range.start, lte: range.end } },
      _sum: { amount: true },
      _count: true,
    });

    const summary = TAX_SECTIONS.map((section) => {
      const match = grouped.find((row) => row.taxSection === section.code);
      const claimed = match?._sum.amount?.toNumber() ?? 0;
      const capped = section.limitInr === null ? claimed : Math.min(claimed, section.limitInr);
      return {
        code: section.code,
        label: section.label,
        limitInr: section.limitInr,
        claimed: Math.round(claimed * 100) / 100,
        allowed: Math.round(capped * 100) / 100,
        utilizationPct: section.limitInr ? Math.min(100, Math.round((claimed / section.limitInr) * 100)) : null,
        transactionCount: match?._count ?? 0,
      };
    });

    return Response.json({
      data: {
        year,
        financialYearLabel: range.label,
        from: range.start.toISOString().slice(0, 10),
        to: range.end.toISOString().slice(0, 10),
        totalClaimed: Math.round(summary.reduce((sum, item) => sum + item.claimed, 0) * 100) / 100,
        totalAllowed: Math.round(summary.reduce((sum, item) => sum + item.allowed, 0) * 100) / 100,
        summary,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
