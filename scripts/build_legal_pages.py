"""Builds hosting/public/{index,privacy,terms}.html from docs/legal/*.md (Evening palette).
Usage: python -I scripts/build_legal_pages.py   then: firebase deploy --only hosting
"""
import html
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
out = root / "hosting" / "public"
out.mkdir(parents=True, exist_ok=True)


def inline(t: str) -> str:
    t = html.escape(t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"_(.+?)_", r"<em>\1</em>", t)
    return t


def md_to_html(md: str) -> str:
    lines, out_html, in_list, in_table = md.splitlines(), [], None, False
    for raw in lines:
        line = raw.rstrip()
        if in_list and not re.match(r"^(\s*[-*]|\d+\.)\s+", line):
            out_html.append(f"</{in_list}>"); in_list = None
        if in_table and not line.startswith("|"):
            out_html.append("</tbody></table>"); in_table = False
        if not line:
            continue
        if m := re.match(r"^(#{1,3})\s+(.*)", line):
            n = len(m.group(1)); out_html.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
        elif line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(re.fullmatch(r"-+", c) for c in cells):
                continue
            if not in_table:
                out_html.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells) + "</tr></thead><tbody>"); in_table = True
            else:
                out_html.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
        elif m := re.match(r"^\s*[-*]\s+(.*)", line):
            if in_list != "ul": out_html.append("<ul>"); in_list = "ul"
            out_html.append(f"<li>{inline(m.group(1))}</li>")
        elif m := re.match(r"^\d+\.\s+(.*)", line):
            if in_list != "ol": out_html.append("<ol>"); in_list = "ol"
            out_html.append(f"<li>{inline(m.group(1))}</li>")
        else:
            out_html.append(f"<p>{inline(line)}</p>")
    if in_list: out_html.append(f"</{in_list}>")
    if in_table: out_html.append("</tbody></table>")
    return "\n".join(out_html)


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
body{{margin:0;background:#0F1422;color:#F2EDE4;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
main{{max-width:720px;margin:0 auto;padding:40px 20px 80px}} h1,h2{{font-family:Georgia,serif;font-weight:400}}
h1{{font-size:2.2rem;margin-bottom:.2em}} h2{{margin-top:2em}} a{{color:#93B4FF}} em{{color:#B5B2AC}}
table{{border-collapse:collapse;width:100%}} td,th{{border-bottom:1px solid #262D3C;padding:8px;text-align:left;vertical-align:top}}
nav a{{margin-right:16px}}</style></head><body><main><nav><a href="index.html">WellTrack AI</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a></nav>
{body}</main></body></html>"""

for name, src in (("privacy", "PRIVACY_POLICY.md"), ("terms", "TERMS.md")):
    md = (root / "docs" / "legal" / src).read_text(encoding="utf-8")
    title = md.splitlines()[0].lstrip("# ").strip()
    (out / f"{name}.html").write_text(PAGE.format(title=html.escape(title), body=md_to_html(md)), encoding="utf-8")

index = """# WellTrack AI

A private wellbeing journal for students: a one-minute daily check-in, on-device activity recognition, insights from your own data, gentle reminders, an exam planner and an optional AI coach.

WellTrack is a wellness tool, not a medical device. If you feel unsafe, contact local emergency services or find a free crisis line at findahelpline.com.

## Support

Questions, bugs or data requests: [SUPPORT EMAIL]. You can delete your account and data inside the app (Settings → Account).
"""
(out / "index.html").write_text(PAGE.format(title="WellTrack AI", body=md_to_html(index)), encoding="utf-8")
print("Wrote", ", ".join(p.name for p in sorted(out.glob("*.html"))))
