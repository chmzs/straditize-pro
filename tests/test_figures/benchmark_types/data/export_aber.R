suppressPackageStartupMessages(library(rioja))
data(aber)
spec <- aber$spec
colnames(spec) <- aber$names$Name
out_df <- data.frame(
  Depth = aber$ages$`Depth (cm)`,
  Age_BP = aber$ages$`Age (years BP)`,
  spec,
  check.names = FALSE
)
target_path <- "tests/test_figures/benchmark_types/data/aber_ground_truth.csv"
write.csv(out_df, target_path, row.names = FALSE)
cat(sprintf("Abernethy ground truth exported: %d rows x %d columns -> %s\n", 
            nrow(out_df), ncol(out_df), target_path))
