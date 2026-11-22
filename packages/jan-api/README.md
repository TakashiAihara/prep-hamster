# jan-api

## JAN code structure

Notes on how a JAN code is built. `isValidJan` validates a code and `computeJanCheckDigit` computes its check digit; both are exported from this package.

Source: a 2023 note from the predecessor repo, checked against GS1 Japan's page on GS1 company prefixes and GTIN (https://www.gs1jp.org/code/jan/about_jan.html, read 2026-11-22). Points the GS1 Japan page does not cover are marked as from the original note.

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

The 95 rule is listed before the 6 to 9 rule because a company code starting 95 also starts with 9.

## Check digit calculation

Positions are counted from the right of the full code, with the check digit itself as position 1.

1. Sum all the even-position digits, then multiply the sum by 3
2. Sum the odd-position digits other than the check digit
3. Add the two results and take the last digit
4. 10 minus that last digit is the check digit; if the last digit is 0, the check digit is 0

`computeJanCheckDigit` takes the digits without the check digit. Its rightmost input digit is therefore position 2 and gets weight 3. Example: `computeJanCheckDigit("490123456789")` returns 4, giving `4901234567894`.

## GTIN-8 (short type)

GS1 Japan sets a short-type code in one of two ways:

- With a GTIN-8 one-off key
- With a 6-digit short-type GS1 company prefix, followed by a 1-digit item code and a 1-digit check digit

The original note also says the short type is used only within Japan and that its first 2 digits are 49 or 45. Neither point is verified on the GS1 Japan page.

## Related: GTIN-14 (not a JAN code)

- A product code for shipping boxes of grouped packaging
- 14 digits
- Contains the 12 digits of a GTIN-13 other than its check digit
- The first digit is an indicator that expresses the packaging state
- Companies may assign it freely
- The check digit is recalculated
