"""命令行验证：在真实 THUCNews 数据上跑通 读取->清洗->TF-IDF->训练->评估。

重点验证：标签没有读反、指标合理。
运行： python backend/scripts/verify_core.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from core import pipeline

DATA_DIR = os.path.join(config.DATASETS_DIR, "thucnews")
TRAIN = os.path.join(DATA_DIR, "train.txt")
TEST = os.path.join(DATA_DIR, "test.txt")


def main():
    print("=" * 64)
    print("数据路径:", DATA_DIR)
    summary = pipeline.run_pipeline(TRAIN, TEST, save=True, model_tag="current")

    print("-" * 64)
    print("标签列探测: train=%s, test=%s  (应为 tail=标签在行尾)" % (
        summary["train_report"]["label_position"], summary["test_report"]["label_position"]))
    print("解析: train parsed=%d skipped=%d | test parsed=%d skipped=%d" % (
        summary["train_report"]["parsed"], summary["train_report"]["skipped"],
        summary["test_report"]["parsed"], summary["test_report"]["skipped"]))
    print("类别数:", summary["num_classes"], "标签映射:", summary["label_names"])
    print("清洗后: 训练 %d 条, 测试 %d 条" % (summary["train_count"], summary["test_count"]))
    fs = summary["feature_stats"]["train"]
    print("TF-IDF: 特征维度=%d 稀疏度=%.2f%% 用时=%.2fs" % (
        fs["n_features"], fs["sparsity"], summary["feature_seconds"]))
    print("特征类型:", summary["feature_stats"]["type_breakdown"])

    print("-" * 64)
    for key in ("nb", "lr"):
        m = summary["results"][key]
        print("[%s] Acc=%.4f  P=%.4f  R=%.4f  F1=%.4f  MacroF1=%.4f  (fit %.3fs)" % (
            config.MODEL_DISPLAY[key], m["accuracy"], m["precision"],
            m["recall"], m["f1"], m["macro_f1"], m["train_seconds"]))
    print("最优模型:", summary["best_model_name"])

    # 抽样预测，肉眼核对"标签没读反"
    print("-" * 64)
    print("抽样核对（标题 -> 真实类别 / 预测类别）:")
    art = pipeline.load_artifacts("current")
    from core import data_loader, preprocess
    rep = data_loader.load_file(TEST)
    names = summary["label_names"]
    clf = art["models"][summary["best_model"]]
    vec = art["vectorizer"]
    for text, label in rep.rows[:6]:
        cleaned = preprocess.clean_text(text)
        pred = int(clf.predict(vec.transform([cleaned]))[0])
        print("  %-40s 真实=%s 预测=%s" % (text[:38], names[label], names[pred]))
    print("=" * 64)


if __name__ == "__main__":
    main()
