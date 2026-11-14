You are an independent checker for an A-Z dictionary of {{domain}} (subtopic: {{subtopic}}). Check this entry for the term "{{term}}".
Entry:
{{entry}}
Answer these six questions with true/false, being strict:
1 belongs_to_subtopic: is the term part of this subtopic?
2 literal_ok: is the literal meaning correct?
3 field_ok: is the meaning in this field correct?
4 effect_usage_ok: are effect and usage correct?
5 hi_en_same: do the Hindi and English versions mean the same thing?
6 level_ok: is the level (basic/advanced) appropriate?
Also give "score" 0-100 for overall correctness and "objections": a list of short, specific problems (empty if none).
Reply with ONE JSON object only: {"belongs_to_subtopic":true,"literal_ok":true,"field_ok":true,"effect_usage_ok":true,"hi_en_same":true,"level_ok":true,"score":0,"objections":[]}