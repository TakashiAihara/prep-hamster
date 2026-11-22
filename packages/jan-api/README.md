# jan-api

## JAN code structure

Notes on how a JAN code is built. `isValidJan` and `computeJanCheckDigit` are exported from this package. `isValidJan` checks only the length (13 or 8), that every character is a digit, and the check digit. It does not check the 45 / 49 prefix or whether the prefix is lent to a company, so `0000000000000` is valid for it.

Source: a 2023 note from the predecessor repo (preppy), checked against GS1 Japan's page on GS1 company prefixes and GTIN (https://www.gs1jp.org/code/jan/about_jan.html, read 2026-11-22). Points the GS1 Japan page does not cover are marked as from the original note.

## General

- JAN stands for Japanese Article Number
- A JAN code is a string of 13 or 8 digits; treat it as a digit string, not a number
- 13 digits is the standard type (GTIN-13)
- 8 digits is the short type (GTIN-8)

## GTIN-13 (standard type)

- The most widely used JAN code in Japan

### GTIN-13 layout

- GS1 company prefix, then item code, then check digit
- GS1 Japan lends prefixes of 9, 10 or 7 digits that start with 45 or 49
- The item code is 3, 2 or 5 digits, so that prefix + item code is always 12 digits
- The check digit is 1 digit

| GS1 company prefix | Item code | Check digit |
| ------------------ | --------- | ----------- |
| 9 digits           | 3 digits  | 1 digit     |
| 10 digits          | 2 digits  | 1 digit     |
| 7 digits           | 5 digits  | 1 digit     |

### Country code

- The first 2 digits of the GS1 company prefix
- For Japan it is either 45 or 49

### Prefix length by leading digits (from the original note)

The original note splits the prefix into a 2-digit country code and a company code and gives these rules. GS1 Japan's page lists only the lengths above, so these rules are not verified there.

- 49: company code 5 digits, item code 5 digits
- 45 with a company code starting 0 to 5: company code 5 digits, item code 5 digits
- 45 with a company code starting 95: company code 8 digits, item code 2 digits
- 45 with any other company code starting 6 to 9: company code 7 digits, item code 3 digits

The 95 rule is listed before the 6 to 9 rule because a company code starting 95 also starts with 9. These rules may be wrong; check GS1 Japan before relying on them in code.

## Check digit calculation

Positions are counted from the right of the full code, with the check digit itself as position 1. The same steps apply to 13-digit and 8-digit codes.

1. Sum all the even-position digits, then multiply the sum by 3
2. Sum the odd-position digits other than the check digit
3. Add the two results and take the last digit
4. 10 minus that last digit is the check digit; if the last digit is 0, the check digit is 0

`computeJanCheckDigit` takes the digits without the check digit. Its rightmost input digit is therefore position 2 and gets weight 3. Examples: `computeJanCheckDigit("456789012345")` returns 6, giving `4567890123456`, and `computeJanCheckDigit("4901234")` returns 7, giving `49012347`. Swapping the odd and even weights would give 8 and 1 for these inputs, so they tell the two apart.

## GTIN-8 (short type)

GS1 Japan sets a short-type code in one of two ways:

- With a GTIN-8 one-off key
- With a 6-digit short-type GS1 company prefix, followed by a 1-digit item code and a 1-digit check digit

The original note also says the short type is used only within Japan and that its first 2 digits are 49 or 45. Neither point is verified on the GS1 Japan page.

## Related: GTIN-14 (not a JAN code)

GS1 Japan's page on GTIN for grouped packaging (https://www.gs1jp.org/code/jan/itf.html, read 2026-11-22) describes it as follows.

- 14 digits: a 1-digit indicator, the first 12 digits of the GTIN-13 of the unit inside, and a recalculated check digit
- Indicators 1 to 8 are for grouped packaging. They tell apart different packing forms, inner and outer boxes, and regular and promotional units, and are used in order from 1 each time a new grouping needs its own code
- Indicator 9 is for variable-measure products and is not used for ordinary grouped packaging
- Example from GS1 Japan: unit GTIN `4512345678906`, grouped packaging GTIN `14512345678903`
- A leading 0 added to a GTIN-13 to make 14 digits for an ITF symbol is not an indicator, and the result is not a grouped packaging GTIN
