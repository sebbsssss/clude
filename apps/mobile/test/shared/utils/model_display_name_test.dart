import 'package:flutter_test/flutter_test.dart';
import 'package:clude_mobile/shared/utils/model_display_name.dart';

void main() {
  group('modelDisplayName', () {
    test('maps claude sonnet', () {
      expect(modelDisplayName('claude-sonnet-4-20250514'), 'Sonnet 4');
    });

    test('maps claude opus', () {
      expect(modelDisplayName('claude-opus-4-20250514'), 'Opus 4');
    });

    test('maps gpt-4o', () {
      expect(modelDisplayName('gpt-4o'), 'GPT-4o');
    });

    test('maps haiku', () {
      expect(modelDisplayName('claude-haiku-3-5'), 'Haiku 3.5');
    });

    test('returns original for unknown model', () {
      expect(modelDisplayName('some-unknown-model'), 'some-unknown-model');
    });
  });
}
