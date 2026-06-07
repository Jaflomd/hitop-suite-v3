from django.core.management.base import BaseCommand
from django.utils import timezone

from clinical.models import BackupRun


class Command(BaseCommand):
    help = "Record a local encrypted backup run in the database."

    def add_arguments(self, parser):
        parser.add_argument("--path", required=True)
        parser.add_argument("--checksum", required=True)
        parser.add_argument("--status", choices=[BackupRun.Status.SUCCESS, BackupRun.Status.FAILED], default=BackupRun.Status.SUCCESS)

    def handle(self, *args, **options):
        run = BackupRun.objects.create(
            status=options["status"],
            destination_path=options["path"],
            checksum_sha256=options["checksum"],
            finished_at=timezone.now(),
        )
        self.stdout.write(self.style.SUCCESS(f"Recorded backup {run.run_id}"))
