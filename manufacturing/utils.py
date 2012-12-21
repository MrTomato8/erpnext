# ERPNext - web based ERP (http://erpnext.com)
# Copyright (C) 2012 Web Notes Technologies Pvt Ltd
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

from __future__ import unicode_literals
import webnotes

@webnotes.whitelist()
def get_bom_raw_materials(qty, bom_no):
	return webnotes.conn.sql("""select item_code, 
		ifnull(sum(qty_consumed_per_unit),0)*%s as qty, description, stock_uom
		from `tabBOM Explosion Item` where parent = %s and docstatus = 1
		group by item_code, stock_uom""" , (qty, bom_no), as_dict=1)