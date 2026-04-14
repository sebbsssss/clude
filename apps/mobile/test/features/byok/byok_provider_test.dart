import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/byok/byok_provider.dart';

class MockSecureStorage extends Mock implements SecureStorageService {}

void main() {
  late MockSecureStorage mockStorage;

  setUp(() {
    mockStorage = MockSecureStorage();
  });

  ProviderContainer createContainer() {
    return ProviderContainer(
      overrides: [
        secureStorageProvider.overrideWithValue(mockStorage),
      ],
    );
  }

  group('ByokKeysNotifier', () {
    test('loadKeys reads all providers from storage', () async {
      when(() => mockStorage.getByokKey('anthropic'))
          .thenAnswer((_) async => 'sk-ant-test');
      when(() => mockStorage.getByokKey('openai'))
          .thenAnswer((_) async => null);
      when(() => mockStorage.getByokKey('google'))
          .thenAnswer((_) async => null);
      when(() => mockStorage.getByokKey('xai'))
          .thenAnswer((_) async => null);
      when(() => mockStorage.getByokKey('deepseek'))
          .thenAnswer((_) async => null);
      when(() => mockStorage.getByokKey('minimax'))
          .thenAnswer((_) async => null);

      final container = createContainer();
      addTearDown(container.dispose);

      // Wait for async loadKeys() in constructor to complete.
      await container.read(byokKeysNotifierProvider.notifier).loadKeys();

      final keys = container.read(byokKeysNotifierProvider);
      expect(keys, {'anthropic': 'sk-ant-test'});
    });

    test('setKey persists and updates state', () async {
      for (final p in byokProviders) {
        when(() => mockStorage.getByokKey(p)).thenAnswer((_) async => null);
      }
      when(() => mockStorage.setByokKey('openai', 'sk-test'))
          .thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);
      await container.read(byokKeysNotifierProvider.notifier).loadKeys();

      await container
          .read(byokKeysNotifierProvider.notifier)
          .setKey('openai', 'sk-test');

      final keys = container.read(byokKeysNotifierProvider);
      expect(keys['openai'], 'sk-test');
      verify(() => mockStorage.setByokKey('openai', 'sk-test')).called(1);
    });

    test('removeKey deletes and updates state', () async {
      when(() => mockStorage.getByokKey('anthropic'))
          .thenAnswer((_) async => 'sk-ant-test');
      for (final p in byokProviders.where((p) => p != 'anthropic')) {
        when(() => mockStorage.getByokKey(p)).thenAnswer((_) async => null);
      }
      when(() => mockStorage.deleteByokKey('anthropic'))
          .thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);
      await container.read(byokKeysNotifierProvider.notifier).loadKeys();

      expect(container.read(byokKeysNotifierProvider).containsKey('anthropic'),
          isTrue);

      await container
          .read(byokKeysNotifierProvider.notifier)
          .removeKey('anthropic');

      expect(container.read(byokKeysNotifierProvider).containsKey('anthropic'),
          isFalse);
    });

    test('clearAll wipes all keys', () async {
      when(() => mockStorage.getByokKey('anthropic'))
          .thenAnswer((_) async => 'sk-ant-test');
      when(() => mockStorage.getByokKey('openai'))
          .thenAnswer((_) async => 'sk-test');
      for (final p in byokProviders.where((p) => p != 'anthropic' && p != 'openai')) {
        when(() => mockStorage.getByokKey(p)).thenAnswer((_) async => null);
      }
      when(() => mockStorage.deleteAllByokKeys()).thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);
      await container.read(byokKeysNotifierProvider.notifier).loadKeys();

      expect(container.read(byokKeysNotifierProvider).length, 2);

      await container.read(byokKeysNotifierProvider.notifier).clearAll();

      expect(container.read(byokKeysNotifierProvider), isEmpty);
      verify(() => mockStorage.deleteAllByokKeys()).called(1);
    });

    test('hasKeyFor returns correct values', () async {
      when(() => mockStorage.getByokKey('anthropic'))
          .thenAnswer((_) async => 'sk-ant-test');
      for (final p in byokProviders.where((p) => p != 'anthropic')) {
        when(() => mockStorage.getByokKey(p)).thenAnswer((_) async => null);
      }

      final container = createContainer();
      addTearDown(container.dispose);
      await container.read(byokKeysNotifierProvider.notifier).loadKeys();

      final notifier = container.read(byokKeysNotifierProvider.notifier);
      expect(notifier.hasKeyFor('anthropic'), isTrue);
      expect(notifier.hasKeyFor('openai'), isFalse);
      expect(notifier.hasKeyFor(null), isFalse);
    });
  });

  group('validateByokKeyFormat', () {
    test('accepts valid prefixes', () {
      expect(validateByokKeyFormat('anthropic', 'sk-ant-abc123'), isTrue);
      expect(validateByokKeyFormat('openai', 'sk-abc123'), isTrue);
      expect(validateByokKeyFormat('google', 'AIzaSyB123'), isTrue);
      expect(validateByokKeyFormat('xai', 'xai-abc123'), isTrue);
      expect(validateByokKeyFormat('deepseek', 'sk-abc123'), isTrue);
      expect(validateByokKeyFormat('minimax', 'eyJabc123'), isTrue);
    });

    test('rejects invalid prefixes', () {
      expect(validateByokKeyFormat('anthropic', 'sk-wrong'), isFalse);
      expect(validateByokKeyFormat('openai', 'wrong'), isFalse);
      expect(validateByokKeyFormat('google', 'wrong'), isFalse);
      expect(validateByokKeyFormat('anthropic', ''), isFalse);
    });

    test('rejects unknown provider', () {
      expect(validateByokKeyFormat('unknown', 'anything'), isFalse);
    });
  });
}
