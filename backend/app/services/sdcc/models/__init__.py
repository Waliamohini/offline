"""
services/sdcc/models/__init__.py
Registry that maps model_type strings to their evaluator classes.
"""
from app.services.sdcc.models.classification import ClassificationEvaluator
from app.services.sdcc.models.rag            import RAGEvaluator
from app.services.sdcc.models.summarization  import SummarizationEvaluator
from app.services.sdcc.models.general_llm    import GeneralLLMEvaluator
from app.services.sdcc.models.automation     import AutomationEvaluator
from app.services.sdcc.models.image_cv       import ImageCVEvaluator

MODEL_REGISTRY: dict = {
    "classification":       ClassificationEvaluator,
    "rag":                  RAGEvaluator,
    "summarization":        SummarizationEvaluator,
    "general_llm":          GeneralLLMEvaluator,
    "automation":           AutomationEvaluator,
    "image_classification": ImageCVEvaluator,
}

def get_evaluator(model_type: str):
    """
    Return the evaluator class for the given model_type.
    Falls back to GeneralLLMEvaluator for unknown types.
    """
    return MODEL_REGISTRY.get(model_type, GeneralLLMEvaluator)