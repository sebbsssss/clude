import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:clude_mobile/core/storage/secure_storage.dart';
import 'package:clude_mobile/core/storage/secure_storage_provider.dart';
import 'package:clude_mobile/features/onboarding/onboarding_provider.dart';

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

  group('OnboardingNotifier', () {
    test('checkAndStart activates when onboarding not complete', () async {
      when(() => mockStorage.isOnboardingComplete())
          .thenAnswer((_) async => false);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(onboardingProvider.notifier);
      await notifier.checkAndStart();

      final state = container.read(onboardingProvider);
      expect(state.isActive, true);
      expect(state.currentStep, 0);
    });

    test('checkAndStart does not activate when onboarding already complete',
        () async {
      when(() => mockStorage.isOnboardingComplete())
          .thenAnswer((_) async => true);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(onboardingProvider.notifier);
      await notifier.checkAndStart();

      final state = container.read(onboardingProvider);
      expect(state.isActive, false);
    });

    test('advanceStep increments currentStep', () async {
      when(() => mockStorage.isOnboardingComplete())
          .thenAnswer((_) async => false);

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(onboardingProvider.notifier);
      await notifier.checkAndStart();
      notifier.advanceStep();

      expect(container.read(onboardingProvider).currentStep, 1);
    });

    test('advanceStep past final step calls complete', () async {
      when(() => mockStorage.isOnboardingComplete())
          .thenAnswer((_) async => false);
      when(() => mockStorage.setOnboardingComplete())
          .thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(onboardingProvider.notifier);
      await notifier.checkAndStart();

      // Advance through all 4 steps (0-3).
      for (var i = 0; i < 4; i++) {
        notifier.advanceStep();
      }

      final state = container.read(onboardingProvider);
      expect(state.isActive, false);
      expect(state.completed, true);
      verify(() => mockStorage.setOnboardingComplete()).called(1);
    });

    test('skip marks onboarding complete immediately', () async {
      when(() => mockStorage.isOnboardingComplete())
          .thenAnswer((_) async => false);
      when(() => mockStorage.setOnboardingComplete())
          .thenAnswer((_) async {});

      final container = createContainer();
      addTearDown(container.dispose);

      final notifier = container.read(onboardingProvider.notifier);
      await notifier.checkAndStart();
      await notifier.skip();

      final state = container.read(onboardingProvider);
      expect(state.isActive, false);
      expect(state.completed, true);
      verify(() => mockStorage.setOnboardingComplete()).called(1);
    });
  });
}
