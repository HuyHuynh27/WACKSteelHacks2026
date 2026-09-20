# Who has this problem, and would they pay

No customer interviews — we ran out of time before we ran out of build. What
follows is desk research, and we've marked what it does and doesn't establish.

## The customer

Small metal fabrication and machine shops: 5 to 50 employees, high-mix,
low-volume, make-to-order.

NAICS 332 (Fabricated Metal Product Manufacturing) covers roughly 54,000
establishments in the US employing about 1.36 million people, with an annual
payroll near $83 billion (US Census, 2020). Two subsectors dominate by
establishment count rather than revenue, which is the shape that matters here:
machine shops, turned product and fastener manufacturing at about 21,800
establishments, and architectural and structural metals at about 23,700. The
sector is projected to grow at roughly 5% CAGR through 2031.

These are businesses that buy aluminum, steel, copper and fasteners by the
pound, quote jobs weeks or months before they buy, and have no full-time
procurement analyst.

## The problem is currently their top problem

This is the part the research settles decisively.

**Raw material price volatility is the #1 driver of rising costs.** Wipfli's
2026 Manufacturing Benchmarking Survey, 456 US facilities, July 2026: raw
material volatility at 26%, ahead of labour at 21%.

**And it is getting sharply worse.** A Q2 2026 survey found 83.1% of
manufacturers naming raw material costs their top business challenge — up from
57.5% the previous quarter. NAM's Q2 2026 Outlook Survey raised expected input
cost growth to 5.8%, from 4.1% projected in Q1.

**The specific pain is the lag, not the price.** Wipfli's finding is almost a
description of this product: manufacturers can usually pass raw material
increases through to customers, but it takes time, and that delay is what
erodes margin. They add that the segments most exposed to raw material
volatility are the same ones seeing the most margin pressure.

**And the worst-hit segment is exactly our target.** Wipfli names metal formers
as under the greatest pressure, with margins trailing other manufacturing
sectors.

**Small firms are hit hardest.** The Joint Economic Committee's April 2026
report found small manufacturers' margins collapsing in tariff-exposed
industries — down 179% in computer and electronic products over the last three
quarters of 2025, down 63% in transportation equipment. A New York Fed analysis
(July 2026) found small businesses were particularly challenged by 2025
tariffs, mostly responding by passing costs to customers, and that those
challenges correlate with pessimism about 2026 revenue.

**They are already acting on it.** Netstock's 2026 Tariff Impact Report: cost
is the #1 issue for 71% of SMBs, with margin pressure a distinct second at 16%,
and 82% now passing tariff-driven increases to customers — up from a year
earlier when 44% were absorbing them internally.

So: the problem is real, it is their stated top concern, it is worsening
quarter over quarter, and the mechanism that hurts is the *delay* between a
material moving and the shop knowing about it. That delay is the thing we
shorten.

## Would they pay, and is there room to

We haven't validated willingness to pay. What we can establish is that this
budget line already exists and that there is a gap in it.

Job-shop ERP is where shops currently buy anything adjacent to this:

| Product | Price |
| --- | --- |
| Carbon | $40/user/mo (Starter), $100/user/mo (Business) |
| JobBOSS² | ~$85–150/user/mo; roughly $10k/yr for a cloud subscription |
| E2 Shop System | from ~$150/user/mo, plus setup and training fees |
| Epicor Kinetic | ~$125/user/mo, implementation typically from $50k |
| Budget tier (MRPeasy, Odoo) | ~$15–25k/yr |

Legacy job-shop ERP is quote-based and runs from a few hundred to over a
thousand dollars per user per month once implementation is counted.

Two things follow. First, a 15-person shop is already spending $10k–40k a year
on software that touches costing, so a $50–100/month tool is a rounding error
against an existing budget rather than a new line item. Second, none of these
watch the market. ERP records the price you *paid*; it does not tell you the
index moved 8% last month and why. Microsoft's own 2026 pitch for Dynamics 365
is that it captures landed cost as part of the transaction — which is still
backward-looking. The forward-looking half is unserved.

## The honest version of the wedge

Not "small businesses." Metal fabrication and machine shops, 5–50 employees, in
the US, who buy on the pound and quote before they buy. About 45,000
establishments between the two largest NAICS 332 subsectors by count.

At $75/month, 1% of that is roughly $400k ARR. That is not a venture outcome on
its own, and we would not claim it is. It is a wedge into a sector whose stated
#1 problem we address directly, and where the mapping layer gets better with
every shop that uses it.

## What we have not done

- **No customer interviews.** Everything above is desk research. The first
  thing we'd do next is ten calls, and the question is not "is this a problem"
  — the surveys answer that — but "what would you pay, and who signs."
- **No pricing test.** $75/month is positioned against ERP spend, not
  validated.
- **No churn or retention signal.** A tool you check when prices move may be a
  tool you forget about when they don't. Push notifications are our answer to
  that, and it is an assumption.

## Sources

- Wipfli, 2026 Manufacturing Benchmarking Survey (456 US facilities), July 2026
  — wipfli.com/news/2026/manufacturing-benchmarking-survey-2026-cost-pressures
- US Census / NAICS 332 establishment and employment data — naicslist.com/naics/332
- NAICS 332 subsector establishment counts — naics.com/six-digit-naics/?code=332
- Metal fabrication statistics, April 2026 — manufacturinglead generation.com/metal-fabrication-statistics
- Q2 2026 raw material cost survey, via Western Computer, June 2026
  — westerncomputer.com/resources/blog/manufacturing-tariff-cost-control-dynamics-365
- NAM Q2 2026 Manufacturers' Outlook Survey, via MANTEC
  — mantec.org/customer-qualification-matrix-manufacturers
- Netstock, 2026 Tariff Impact Report, April 2026 — netstock.com/research/2026-tariff-impact-report
- US Congress Joint Economic Committee (Minority), small manufacturing report, April 2026
  — jec.senate.gov
- Federal Reserve Bank of New York, Liberty Street Economics, July 2026
  — libertystreeteconomics.newyorkfed.org/2026/07/effect-of-tariffs-on-u-s-small-businesses
- ERP pricing: WorkCell (March 2026), Carbon (July 2026), ITQlick (Feb 2026),
  VendorBenchmark (May 2026)