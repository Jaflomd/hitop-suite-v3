from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand

from clinical.batteries import DEFAULT_BATTERIES, DEFAULT_GROUPS, SCALE_LABELS
from clinical.models import BatteryTemplate, BatteryTemplateScale


class Command(BaseCommand):
    help = "Seed local roles and default battery templates."

    def handle(self, *args, **options):
        for group_name in DEFAULT_GROUPS:
            Group.objects.get_or_create(name=group_name)
            self.stdout.write(f"group:{group_name}")

        for name, spec in DEFAULT_BATTERIES.items():
            template, _ = BatteryTemplate.objects.update_or_create(
                name=name,
                defaults={"description": spec["description"], "is_active": True},
            )
            for order, scale_id in enumerate(spec["scales"], start=1):
                BatteryTemplateScale.objects.update_or_create(
                    template=template,
                    scale_id=scale_id,
                    defaults={
                        "scale_label": SCALE_LABELS.get(scale_id, scale_id),
                        "order": order,
                        "required": True,
                        "role_visible_to": BatteryTemplateScale.RoleVisibleTo.ALL,
                    },
                )
            template.scales.exclude(scale_id__in=spec["scales"]).delete()
            self.stdout.write(f"battery:{name}:{len(spec['scales'])}")
