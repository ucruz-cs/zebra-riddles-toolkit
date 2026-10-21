export const LLM_PROMPT = `You are transcribing a zebra / Einstein logic-grid puzzle from a screenshot into JSON for a "Zebra / Einstein Riddles" solving app.

FIRST: decide whether the screenshot contains the complete value set for every category.

If information is missing, STOP. Do not output JSON, do not guess, and do not invent values. Instead, ask the user for the missing information in the chat. It is missing when any of these is true:
- a category has fewer known values than there are position columns (for example 5 houses but only 4 shirt colours are visible);
- the value list / legend is absent, cut off, or unreadable;
- a clue is cut off, unreadable, or truncated;
- the number of positions or a category label cannot be determined.

When you ask, name each incomplete category, say how many values are required, and list the values you already have. Example: "The Shirt category needs 5 values but the screenshot only shows black, blue and green. Please send the remaining shirt colours." Wait for the user's reply, then produce the full JSON. Values may be hidden inside the screenshot's dropdowns — if they are not visible anywhere, ask; never guess.

Otherwise, return ONLY valid JSON. No markdown fences, no commentary, no trailing text.

Schema:
{
  "title": "short puzzle title",
  "positions": { "label": "House", "labels": ["#1", "#2", "#3", "#4", "#5"] },
  "categories": [
    { "id": "color", "label": "Color", "values": ["black", "blue", "green", "red", "white"] },
    { "id": "tree", "label": "Tree", "values": ["bamboo", "palm", "oak", "spruce", "pine"] }
  ],
  "clues": [
    {
      "id": "c1",
      "text": "The neighbor who plays the Vocals lives in the house with the Palm tree.",
      "constraints": [{ "type": "same", "a": "instrument:vocals", "b": "tree:palm" }]
    }
  ]
}

Rules:
1. Layout: one category per table row, in the order shown. The position columns (House #1 … House #5, Passenger #1 …, etc.) define the position count. Every category must have exactly that many values.
2. Value pool: if the screenshot also shows a separate list of possible values, treat it as the complete value set for each category. Its display order is irrelevant. Preserve the exact spelling and capitalization of every value.
3. Transcribe the puzzle as originally posed. Ignore any cells that are already filled and any clues already checked in the screenshot — those are the user's own progress, not part of the puzzle. The generated game must start empty.
4. Copy every clue's wording verbatim into "text", in reading order (left column top-to-bottom, then right column). Do not paraphrase, correct, shorten, or merge clues.
5. Category ids: short, lowercase, unique, derived from the row label (shirt, name, color, nationality, seafood, tree, instrument, breakfast, …). References look like "categoryId:Value" and are matched case-insensitively.
6. Constraint types (positions are 1-based; use only these):
   - { "type": "at", "subject": "REF", "positions": "ends" | "first" | "last" | "middle" | [1, 4] }
   - { "type": "same", "a": "REF", "b": "REF" }                 both are in the same position
   - { "type": "nextTo", "a": "REF", "b": "REF" }                adjacent, either order
   - { "type": "immediatelyBefore", "a": "REF", "b": "REF" }     a is the direct left neighbour of b (b = a + 1)
   - { "type": "immediatelyAfter", "a": "REF", "b": "REF" }      a is the direct right neighbour of b (a = b + 1)
   - { "type": "leftOf", "a": "REF", "b": "REF" }                a is somewhere to the left of b
   - { "type": "rightOf", "a": "REF", "b": "REF" }               a is somewhere to the right of b
   - { "type": "between", "subject": "REF", "after": "REF", "before": "REF" }
7. Phrase mapping:
   - "is", "is the person who", "is the one who" -> same
   - "adjacent to", "beside", "next to" -> nextTo
   - "directly / immediately to the right of" -> immediatelyAfter
   - "directly / immediately to the left of" -> immediatelyBefore
   - "somewhere to the right of" -> rightOf
   - "somewhere to the left of" -> leftOf
   - "somewhere between A and B, in that order" -> between with after = A, before = B
   - "in one of the corner houses", "in one of the end houses" -> at + "positions": "ends"
   - "in the first / last position" -> at + "first" / "last"
8. Paraphrases: clues often describe a value instead of naming it. Map the paraphrase to the exact value in the constraint, but keep the original wording in "text". Examples: "a book that features time travel" -> "genre:Science fiction"; "the 46-year-old" -> "age:46 years"; "the oldest" -> "age:max"; "the youngest" -> "age:min". max/min mean the numerically highest/lowest value of that category.
9. References may come from different categories. "Bethany is between Theodore and Tiffany" relates a name, a boy and a name.
10. If one clue states two separate facts, put two constraints in its array. If a clue truly cannot be encoded, keep the text and use "constraints": [] — never invent a constraint or a value.
11. Do not solve the puzzle. Do not output a grid, a solution, or any explanation.
12. Before answering, verify:
   - each category has exactly as many values as there are positions;
   - every REF uses an exact value from the categories block, spelled and capitalised the same way;
   - every clue from the screenshot is present, with non-empty text;
   - the whole response parses as JSON.
If any of those checks fails because the screenshot is incomplete, ask the user for the missing values (see the first instruction) instead of producing an incomplete or invented JSON.
`
