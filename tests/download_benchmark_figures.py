import os
import shutil
import urllib.request

target_dir = r"I:\software_dev\straditize\tests\test_figures\benchmark_types"
os.makedirs(target_dir, exist_ok=True)

headers = {"User-Agent": "Mozilla/5.0"}

downloads = [
    (
        "type1_filled_silhouette_aber.png",
        "https://raw.githubusercontent.com/nsj3/riojaPlot/main/Figures/aber.png",
    ),
    (
        "type2_exaggeration_bell.png",
        "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhF0k7fC2UTzCioI79fx2kRoECoaJzLFOoDI8sEljCn2l6F7DVRueV4Zo6RapOOLDAN-EUOsQ8m-XiyVSL7lIH1w0jilqYBJMzi2GqIQtc7ZQ7FvDiErIpAmVEKC585jE3I0paMQftceAU/s1600/pollen_exaggerated.png",
    ),
    (
        "type3_discrete_bars_bell.png",
        "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEisvgkL7ubeb25FIciZIwxdxyjomHHz7AOwJlNUkMFEk1nQnWb8W0sPMpwpq5fdBAyyMwfRJfp84QmVcsqe_bicsYbbJ0eAoWkt8lfurkJ7gqaJXsY7vKXabMRcilf624Jo-66uQE18uOU/s1600/pollen_filled_bars.png",
    ),
    (
        "type6_composite_zonation_cluster.png",
        "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhnDOXvUqKzUMctBPKnY9jN_9kP2Onz4xSB-jCiXierZh1x4Fi4kQFM-8LJqBoA7qMhUT7ykd4yyAk2xK0fstISjBlvUoCfBKRe4NHfdeG8TgF1N03JlwDuXql5AePj88FfeAjBt7bNf2E/s1600/pollen_cluster.png",
    ),
    # Additional SVG assets from riojaPlot
    (
        "riojaPlot_Fig1_styles.svg",
        "https://raw.githubusercontent.com/nsj3/riojaPlot/main/Figures/Fig1.svg",
    ),
    (
        "riojaPlot_Fig2_zonation.svg",
        "https://raw.githubusercontent.com/nsj3/riojaPlot/main/Figures/Fig2.svg",
    ),
    (
        "riojaPlot_Fig3_elements.svg",
        "https://raw.githubusercontent.com/nsj3/riojaPlot/main/Figures/Fig3.svg",
    ),
    (
        "riojaPlot_Fig4_custom_proxies.svg",
        "https://raw.githubusercontent.com/nsj3/riojaPlot/main/Figures/Fig4.svg",
    ),
]

for fname, url in downloads:
    fpath = os.path.join(target_dir, fname)
    print(f"Downloading {fname} from {url}...")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read()
            with open(fpath, "wb") as f:
                f.write(content)
        print(f"  -> Saved {fname} ({len(content)} bytes)")
    except Exception as e:
        print(f"  -> Failed to download {fname}: {e}")

# Local docs assets for Type 4 (pure line) and Type 5 (small features / symbols)
src_line = r"I:\software_dev\straditize\straditize\build\lib\straditize\widgets\docs\line-diagram.png"
if not os.path.exists(src_line):
    src_line = r"I:\software_dev\straditize\straditize\straditize\widgets\docs\line-diagram.png"
if os.path.exists(src_line):
    dst_line = os.path.join(target_dir, "type4_pure_line_proxy.png")
    shutil.copyfile(src_line, dst_line)
    print(f"Copied {src_line} -> {dst_line}")

src_feat = r"I:\software_dev\straditize\straditize\build\lib\straditize\widgets\docs\basic_diagram_small_features.png"
if not os.path.exists(src_feat):
    src_feat = r"I:\software_dev\straditize\straditize\straditize\widgets\docs\basic_diagram_small_features.png"
if os.path.exists(src_feat):
    dst_feat = os.path.join(target_dir, "type5_presence_symbols.png")
    shutil.copyfile(src_feat, dst_feat)
    print(f"Copied {src_feat} -> {dst_feat}")

print("\nBenchmark figures download complete:")
for f in sorted(os.listdir(target_dir)):
    sz = os.path.getsize(os.path.join(target_dir, f))
    print(f" - {f}: {sz} bytes")
